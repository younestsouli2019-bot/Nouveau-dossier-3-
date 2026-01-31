import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { generatePayerLinks, writeOutputs } from "../src/paypal-links.mjs";

function getArg(name, def) {
	const idx = process.argv.indexOf(name);
	if (idx >= 0 && idx < process.argv.length - 1) return process.argv[idx + 1];
	return def;
}

function findCandidateCsvs() {
	const roots = [
		path.resolve("archive"),
		path.resolve("settlements", "paypal"),
		path.resolve("exports"),
		path.resolve("reports"),
		path.resolve("."),
	];
	const out = [];
	function walk(dir) {
		try {
			const entries = fs.readdirSync(dir, { withFileTypes: true });
			for (const e of entries) {
				const p = path.join(dir, e.name);
				if (e.isDirectory()) walk(p);
				else if (e.isFile() && e.name.toLowerCase().endsWith(".csv")) {
					out.push(p);
				}
			}
		} catch {}
	}
	for (const root of roots) walk(root);
	// Deduplicate
	return Array.from(new Set(out));
}

function hasRequiredHeaders(records) {
	if (!Array.isArray(records) || records.length === 0) return false;
	const r = records[0];
	return (
		Object.prototype.hasOwnProperty.call(r, "Email") &&
		(Object.prototype.hasOwnProperty.call(r, "Amount") ||
			Object.prototype.hasOwnProperty.call(r, "amount"))
	);
}

function hasPerPayerHeaders(records) {
	if (!Array.isArray(records) || records.length === 0) return false;
	const r = records[0];
	return (
		Object.prototype.hasOwnProperty.call(r, "payer") &&
		Object.prototype.hasOwnProperty.call(r, "amount") &&
		Object.prototype.hasOwnProperty.call(r, "currency") &&
		(Object.prototype.hasOwnProperty.call(r, "note") ||
			Object.prototype.hasOwnProperty.call(r, "message")) &&
		Object.prototype.hasOwnProperty.call(r, "link")
	);
}

async function main() {
	const csvPath = getArg(
		"--csv",
		path.resolve("archive", "paypal_masspayout_ready.csv"),
	);
	const businessEmail = getArg("--email", process.env.OWNER_PAYPAL_EMAIL);
	const allMode = process.argv.includes("--all");
	const targets = [];
	if (allMode) {
		for (const p of findCandidateCsvs()) {
			try {
				const raw = fs.readFileSync(p, "utf8");
				const records = parse(raw, { columns: true, skip_empty_lines: true });
				if (hasRequiredHeaders(records) || hasPerPayerHeaders(records)) {
					targets.push({ path: p, records });
				}
			} catch {}
		}
		if (targets.length === 0) {
			throw new Error("No candidate CSVs with Email/Amount headers found");
		}
	} else {
		if (!fs.existsSync(csvPath)) {
			throw new Error(`CSV not found: ${csvPath}`);
		}
		const raw = fs.readFileSync(csvPath, "utf8");
		const records = parse(raw, { columns: true, skip_empty_lines: true });
		targets.push({ path: csvPath, records });
	}
	const outDir = path.resolve("out", "paypal");
	fs.mkdirSync(outDir, { recursive: true });
	let total = 0;
	for (const t of targets) {
		let links = [];
		if (hasRequiredHeaders(t.records)) {
			const payers = t.records
				.filter((r) => (r.Email ?? "").trim() !== "")
				.map((r) => ({
					email: r.Email.trim(),
					amount: Number(r.Amount ?? r.amount),
					currency: (r.Currency ?? "USD").trim(),
					note: (r.Note ?? "").trim(),
				}));
			links = generatePayerLinks(payers, { businessEmail });
		} else if (hasPerPayerHeaders(t.records)) {
			links = t.records.map((r) => ({
				email: String(r.payer ?? "").trim(),
				amount: Number(r.amount),
				currency: String(r.currency ?? "USD").trim(),
				note: String(r.note ?? r.message ?? "").trim(),
				url: String(r.link ?? "").trim(),
			}));
		}
		const base = path.basename(t.path).replace(/\.csv$/i, "");
		const { jsonPath, csvPath: outCsv } = await writeOutputs(links, {
			outDir,
			jsonName: `payer-links_${base}.json`,
			csvName: `payer-links_${base}.csv`,
		});
		total += links.length;
		console.log(`Generated ${links.length} links from ${t.path}`);
		console.log(`  JSON: ${jsonPath}`);
		console.log(`  CSV: ${outCsv}`);
	}
	console.log(`Total generated links: ${total}`);
}

main().catch((e) => {
	console.error(e?.message ?? String(e));
	process.exitCode = 1;
});
