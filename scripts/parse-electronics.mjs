import fs from "node:fs";
import path from "node:path";
import xlsx from "xlsx";

function ensureDir(p) {
	fs.mkdirSync(path.dirname(p), { recursive: true });
}
function writeJson(p, obj) {
	ensureDir(p);
	fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}
function normalizeBrand(s) {
	const v = String(s || "")
		.trim()
		.toUpperCase();
	const map = {
		BIC: "BIC",
		MAPED: "MAPED",
		DELI: "DELI",
		UHU: "UHU",
		CASIO: "CASIO",
		ACCORD: "ACCORD",
		EXPRESS: "EXPRESS",
		"TOP SAM": "TOP SAM",
		TOPSAM: "TOP SAM",
	};
	for (const k of Object.keys(map)) {
		if (v.includes(k)) return map[k];
	}
	return v || null;
}
function assignId(i) {
	return `ATF-E-${String(i).padStart(6, "0")}`;
}
function readCsv(p) {
	const txt = fs.readFileSync(p, "utf8");
	const lines = txt.split(/\r?\n/).filter((l) => l.trim());
	if (!lines.length) return { headers: [], rows: [] };
	function parseLine(line) {
		const out = [];
		let cur = "";
		let inQ = false;
		for (let i = 0; i < line.length; i++) {
			const ch = line[i];
			if (inQ) {
				if (ch === '"' && line[i + 1] === '"') {
					cur += '"';
					i++;
				} else if (ch === '"') {
					inQ = false;
				} else {
					cur += ch;
				}
			} else {
				if (ch === ",") {
					out.push(cur);
					cur = "";
				} else if (ch === '"') {
					inQ = true;
				} else {
					cur += ch;
				}
			}
		}
		out.push(cur);
		return out.map((v) => v.trim());
	}
	const headers = parseLine(lines[0]).map((h) => h.trim());
	const rows = [];
	for (let i = 1; i < lines.length; i++) {
		const vals = parseLine(lines[i]);
		const obj = {};
		for (let j = 0; j < headers.length; j++)
			obj[headers[j] || `col_${j}`] = vals[j] ?? "";
		rows.push(obj);
	}
	return { headers, rows };
}
function preferFile(...paths) {
	for (const p of paths) {
		try {
			fs.accessSync(p);
			return p;
		} catch {}
	}
	return null;
}
function main() {
	const root = process.cwd();
	const dir = path.resolve(root, "catalogue");
	const src = preferFile(
		path.join(dir, "electronics.xlsx"),
		path.join(dir, "electronics.csv"),
	);
	if (!src) {
		process.stdout.write(
			JSON.stringify({
				ok: false,
				error: "electronics.xlsx or electronics.csv not found",
			}) + "\n",
		);
		process.exitCode = 1;
		return;
	}
	let rows = [];
	if (src.endsWith(".xlsx")) {
		const wb = xlsx.readFile(src);
		const sheet = wb.Sheets[wb.SheetNames[0]];
		rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });
	} else {
		rows = readCsv(src).rows;
	}
	const items = [];
	let idx = 1;
	for (const r of rows) {
		const brand = normalizeBrand(
			r.brand || r.Brand || r.marque || r.Marque || "",
		);
		const name_fr = (
			r.name_fr ||
			r.Name ||
			r.Produit ||
			r.product ||
			""
		).trim();
		const name_ar = (r.name_ar || r["Produit_ar"] || "").trim();
		const price = (r.price || r["prix"] || r["prix_de_vente"] || "").trim();
		const label = name_fr || name_ar;
		if (!label) continue;
		const id = assignId(idx++);
		items.push({ id, brand, name_fr, name_ar, label, price });
	}
	const out = { source: path.basename(src), count: items.length, items };
	const outPath = path.join(dir, "catalogue_electronics.json");
	writeJson(outPath, out);
	process.stdout.write(
		JSON.stringify({ ok: true, outJson: outPath, count: items.length }) + "\n",
	);
}
main();
