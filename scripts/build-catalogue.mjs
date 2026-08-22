import fs from "node:fs";
import path from "node:path";

function readDirSafe(dir) {
	try {
		return fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
}

function fileSize(p) {
	try {
		const s = fs.statSync(p);
		return Number(s.size || 0) || 0;
	} catch {
		return 0;
	}
}

function ensureDir(p) {
	fs.mkdirSync(p, { recursive: true });
}

function writeText(p, txt) {
	ensureDir(path.dirname(p));
	fs.writeFileSync(p, txt);
}

function sanitizeName(name) {
	return String(name || "")
		.replace(/\.[a-z0-9]+$/i, "")
		.replace(/[_\-]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function buildHtml({ furniture, electronics, notes }) {
	const css =
		"body{font-family:system-ui,Segoe UI,Arial,sans-serif;margin:20px;color:#111;background:#fff}" +
		"h1,h2{margin:0 0 10px}" +
		".section{margin:20px 0}" +
		".grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}" +
		".card{border:1px solid #ddd;border-radius:8px;overflow:hidden;background:#fafafa}" +
		".card img{width:100%;height:auto;display:block}" +
		".card .meta{padding:8px;font-size:14px;color:#333}" +
		".warn{padding:10px;border-left:4px solid #d6a700;background:#fff8e1;color:#5b4500;border-radius:6px}";
	function cards(items) {
		return items
			.map(
				(it) =>
					`<div class="card"><img alt="${it.label}" src="${it.src}"/><div class="meta">${it.label}${it.price ? " • " + it.price : ""}</div></div>`,
			)
			.join("");
	}
	return (
		'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
		"<title>Catalogue</title><style>" +
		css +
		"</style></head><body>" +
		"<h1>Catalogue illustré</h1>" +
		`<div class="warn">${notes}</div>` +
		'<div class="section"><h2>Mobilier (sans prix)</h2><div class="grid">' +
		cards(furniture) +
		"</div></div>" +
		'<div class="section"><h2>Électronique (prix: se référer à la liste)</h2><div class="grid">' +
		cards(electronics) +
		"</div></div>" +
		"</body></html>"
	);
}

function main() {
	const root = process.cwd();
	const catDir = process.env.CATALOGUE_DIR || path.resolve(root, "catalogue");
	const outHtml = path.resolve(catDir, "catalogue.html");
	const allowed = [".jpg", ".jpeg", ".png", ".webp"];
	const minBytes = 10_000;
	const entries = readDirSafe(catDir);
	const furniture = [];
	const electronics = [];
	const invalid = [];
	for (const e of entries) {
		if (!e.isFile()) continue;
		const ext = path.extname(e.name).toLowerCase();
		if (!allowed.includes(ext)) continue;
		const abs = path.join(catDir, e.name);
		const size = fileSize(abs);
		if (size < minBytes) {
			invalid.push(e.name);
			continue;
		}
		const rel = e.name;
		const label = sanitizeName(e.name);
		const item = { src: rel, label };
		if (/electronics|electro|tv|laptop|phone|camera/i.test(label)) {
			electronics.push({ ...item, price: "Prix de vente: voir liste" });
		} else {
			furniture.push(item);
		}
	}
	const notes =
		invalid.length > 0
			? "Images invalides/insuffisantes filtrées: " + invalid.join(", ")
			: "Validation des images: ok (taille >= 10KB; formats JPEG/PNG/WebP).";
	const html = buildHtml({ furniture, electronics, notes });
	writeText(outHtml, html);
	process.stdout.write(JSON.stringify({ ok: true, outHtml }) + "\n");
}

main();
