import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { generatePayerLinks, writeOutputs } from "../src/paypal-links.mjs";

function getArg(name, def) {
	const idx = process.argv.indexOf(name);
	if (idx >= 0 && idx < process.argv.length - 1) return process.argv[idx + 1];
	return def;
}

async function main() {
	const csvPath = getArg("--csv", path.resolve("archive", "paypal_masspayout_ready.csv"));
	const businessEmail = process.env.OWNER_PAYPAL_EMAIL;
	if (!fs.existsSync(csvPath)) {
		throw new Error(`CSV not found: ${csvPath}`);
	}
	const raw = fs.readFileSync(csvPath, "utf8");
	const records = parse(raw, {
		columns: true,
		skip_empty_lines: true,
	});
	const payers = records
		.filter((r) => (r.Email ?? "").trim() !== "")
		.map((r) => ({
			email: r.Email.trim(),
			amount: Number(r.Amount),
			currency: (r.Currency ?? "USD").trim(),
			note: (r.Note ?? "").trim(),
		}));
	const links = generatePayerLinks(payers, { businessEmail });
	const { jsonPath, csvPath: outCsv } = await writeOutputs(links, {
		outDir: path.resolve("out", "paypal"),
	});
	console.log(`Generated ${links.length} payer links`);
	console.log(`JSON: ${jsonPath}`);
	console.log(`CSV: ${outCsv}`);
}

main().catch((e) => {
	console.error(e?.message ?? String(e));
	process.exitCode = 1;
});
