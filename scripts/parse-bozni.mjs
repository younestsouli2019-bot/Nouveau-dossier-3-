import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");

function ensureDir(p) {
	fs.mkdirSync(path.dirname(p), { recursive: true });
}

function writeJson(p, obj) {
	ensureDir(p);
	fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

function isArabic(s) {
	return /[\u0600-\u06FF]/.test(String(s || ""));
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
	return null;
}

function detectVariantTokens(s) {
	const out = [];
	const lower = String(s || "").toLowerCase();
	const colors = [
		"noir",
		"bleu",
		"rouge",
		"vert",
		"jaune",
		"blanc",
		"argent",
		"doré",
		"gold",
		"black",
		"white",
		"red",
		"blue",
		"green",
	];
	for (const c of colors)
		if (lower.includes(c)) out.push({ kind: "color", value: c });
	const sizeMatch = lower.match(/\b(\d+)\s*(mm|cm|ml|l|a[34]|x\d+)\b/gi);
	if (sizeMatch)
		for (const m of sizeMatch) out.push({ kind: "size", value: m });
	const packMatch = lower.match(/\b(\d+)\s*(pcs|pièces|pack|x)\b/gi);
	if (packMatch)
		for (const m of packMatch) out.push({ kind: "pack", value: m });
	return out;
}

function assignId(idx) {
	const n = String(idx).padStart(6, "0");
	return `ATF-${n}`;
}

async function extractPageText(doc, pageNum) {
	const page = await doc.getPage(pageNum);
	const content = await page.getTextContent();
	const items = content.items.map((it) => {
		return {
			str: it.str,
			x: it.transform[4],
			y: it.transform[5],
		};
	});
	items.sort((a, b) => (a.y === b.y ? a.x - b.x : b.y - a.y));
	const lines = [];
	let curY = null;
	let buf = [];
	for (const it of items) {
		if (curY == null) curY = it.y;
		if (Math.abs(it.y - curY) > 3) {
			lines.push(buf.join(" ").replace(/\s+/g, " ").trim());
			buf = [it.str];
			curY = it.y;
		} else {
			buf.push(it.str);
		}
	}
	if (buf.length) lines.push(buf.join(" ").replace(/\s+/g, " ").trim());
	return lines.filter((l) => l && l.length > 0);
}

function buildProductsFromLines(lines) {
	const products = [];
	let cur = null;
	for (const ln of lines) {
		const brand = normalizeBrand(ln);
		if (brand) {
			if (cur) {
				products.push(cur);
				cur = null;
			}
			cur = {
				brand,
				name_fr: "",
				name_ar: "",
				variants: [],
			};
			continue;
		}
		if (!cur) {
			cur = {
				brand: null,
				name_fr: "",
				name_ar: "",
				variants: [],
			};
		}
		if (isArabic(ln)) {
			cur.name_ar = (cur.name_ar ? cur.name_ar + " " : "") + ln;
		} else {
			cur.name_fr = (cur.name_fr ? cur.name_fr + " " : "") + ln;
		}
		const v = detectVariantTokens(ln);
		if (v.length) cur.variants.push(...v);
	}
	if (cur) products.push(cur);
	return products
		.map((p, i) => {
			const id = assignId(i + 1);
			const label = (p.name_fr || p.name_ar || "").trim();
			const variants = [];
			const seen = new Set();
			for (const v of p.variants) {
				const k = `${v.kind}:${v.value}`;
				if (!seen.has(k)) {
					variants.push(v);
					seen.add(k);
				}
			}
			return {
				id,
				brand: p.brand,
				name_fr: p.name_fr.trim(),
				name_ar: p.name_ar.trim(),
				label,
				variants,
			};
		})
		.filter((p) => p.label);
}

async function main() {
	const root = process.cwd();
	const pdfPath =
		process.env.BOZNI_PDF || path.resolve(root, "catalogue", "bozni.pdf");
	const outJson =
		process.env.OUT_JSON ||
		path.resolve(root, "catalogue", "catalogue_master.json");
	const buf = fs.readFileSync(pdfPath);
	const data = new Uint8Array(buf);
	const doc = await pdfjsLib.getDocument({ data }).promise;
	const maxPages = Math.min(6, doc.numPages);
	const allLines = [];
	for (let p = 1; p <= maxPages; p++) {
		const lines = await extractPageText(doc, p);
		allLines.push(...lines);
	}
	const products = buildProductsFromLines(allLines);
	writeJson(outJson, {
		source: path.basename(pdfPath),
		pages: maxPages,
		count: products.length,
		items: products,
	});
	process.stdout.write(
		JSON.stringify({ ok: true, outJson, count: products.length }) + "\n",
	);
}

main().catch((err) => {
	process.stderr.write(
		JSON.stringify({ ok: false, error: String((err && err.message) || err) }) +
			"\n",
	);
	process.exitCode = 1;
});
