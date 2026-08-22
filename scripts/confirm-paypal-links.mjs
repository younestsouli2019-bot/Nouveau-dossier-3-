 import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";

function getArg(name, def) {
	const idx = process.argv.indexOf(name);
	if (idx >= 0 && idx < process.argv.length - 1) return process.argv[idx + 1];
	return def;
}

function readCsv(csvPath) {
	const raw = fs.readFileSync(csvPath, "utf8");
	return parse(raw, { columns: true, skip_empty_lines: true });
}

function tryReadJson(jsonPath) {
	try {
		const txt = fs.readFileSync(jsonPath, "utf8");
		return JSON.parse(txt);
	} catch {
		return null;
	}
}

function summarize(csvRecords, outputLinks, ownerEmail) {
	const totalRows = csvRecords.length;
	const rowsWithEmail = csvRecords.filter((r) => (r.Email ?? "").trim() !== "");
	const expected = rowsWithEmail.length;
	const generated = Array.isArray(outputLinks) ? outputLinks.length : 0;
	const issues = [];

	if (!ownerEmail || String(ownerEmail).trim() === "") {
		issues.push("Missing OWNER_PAYPAL_EMAIL");
	}
	if (generated !== expected) {
		issues.push(`Generated count ${generated} does not match expected ${expected}`);
	}
	for (const l of outputLinks ?? []) {
		if (!String(l.url).startsWith("https://www.paypal.com/cgi-bin/webscr?cmd=_xclick")) {
			issues.push("Invalid link prefix for a generated item");
			break;
		}
		if (ownerEmail) {
			const enc = encodeURIComponent(ownerEmail);
			if (!String(l.url).includes(`business=${enc}`)) {
				issues.push("Generated link business param does not match OWNER_PAYPAL_EMAIL");
				break;
			}
		}
	}
	const missingEmailRows = totalRows - expected;
	const confirmed = issues.length === 0 && expected > 0;
	return {
		totalRows,
		rowsWithEmail: expected,
		missingEmailRows,
		generatedLinksCount: generated,
		confirmed,
		issues,
	};
}

async function main() {
	const csvPath = getArg("--csv", path.resolve("archive", "paypal_masspayout_ready.csv"));
	const outJsonPath = getArg("--out-json", path.resolve("out", "paypal", "payer-links.json"));
	const outConfirmPath = getArg("--confirm-out", path.resolve("out", "paypal", "confirmation.json"));
	if (!fs.existsSync(csvPath)) throw new Error(`CSV not found: ${csvPath}`);
	const csvRecords = readCsv(csvPath);
	const outputLinks = tryReadJson(outJsonPath);
	const ownerEmail = process.env.OWNER_PAYPAL_EMAIL;
	const summary = summarize(csvRecords, outputLinks, ownerEmail);
	fs.mkdirSync(path.dirname(outConfirmPath), { recursive: true });
	fs.writeFileSync(outConfirmPath, JSON.stringify(summary, null, 2), "utf8");
	console.log(JSON.stringify(summary));
	if (!summary.confirmed) {
		process.exitCode = 2;
	}
}

main().catch((e) => {
	console.error(e?.message ?? String(e));
	process.exitCode = 1;
});
