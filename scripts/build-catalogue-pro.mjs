import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
	const args = {};
	for (let i = 2; i < argv.length; i++) {
		const a = argv[i];
		if (!a.startsWith("--")) continue;
		const key = a.slice(2);
		const next = argv[i + 1];
		if (!next || next.startsWith("--")) {
			args[key] = true;
		} else {
			args[key] = next;
			i++;
		}
	}
	return args;
}

function readJson(p) {
	try {
		const txt = fs.readFileSync(p, "utf8");
		return JSON.parse(txt);
	} catch {
		return null;
	}
}

function ensureDir(p) {
	fs.mkdirSync(path.dirname(p), { recursive: true });
}

function writeText(p, txt) {
	ensureDir(p);
	fs.writeFileSync(p, txt);
}

function readJsonIfExists(p) {
	try {
		const txt = fs.readFileSync(p, "utf8");
		return JSON.parse(txt);
	} catch {
		return null;
	}
}

function slugify(s) {
	return String(s || "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
}

function findProductImage(baseDir, item) {
	const exts = [".jpg", ".jpeg", ".png", ".webp"];
	const tryNames = [];
	if (item.id) tryNames.push(item.id);
	const combo = `${item.brand || ""}-${item.label || item.name_fr || ""}`;
	tryNames.push(slugify(combo));
	tryNames.push(slugify(item.label || item.name_fr || ""));
	for (const name of tryNames) {
		for (const ext of exts) {
			const p = path.resolve(baseDir, `${name}${ext}`);
			try {
				fs.accessSync(p);
				return p;
			} catch {}
		}
	}
	return null;
}

function placeholderImage(label, w = 520, h = 340) {
	const hue =
		Math.abs(
			Array.from(String(label || "")).reduce(
				(a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0,
				0,
			),
		) % 360;
	const svg = encodeURIComponent(
		`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>` +
			`<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='hsl(${hue},70%,55%)'/><stop offset='100%' stop-color='hsl(${(hue + 60) % 360},70%,45%)'/></linearGradient></defs>` +
			`<rect width='100%' height='100%' rx='14' fill='url(#g)'/>` +
			`<text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='white' font-family='system-ui' font-size='22'>${String(label || "").slice(0, 42)}</text>` +
			`</svg>`,
	);
	return `data:image/svg+xml;charset=utf-8,${svg}`;
}

function toFileUrl(p) {
	return `file:///${String(p).replace(/\\\\/g, "/")}`;
}

function listImages(baseDir) {
	const allowed = new Set([".jpg", ".jpeg", ".png", ".webp"]);
	try {
		const files = [];
		const stack = [baseDir];
		while (stack.length) {
			const dir = stack.pop();
			let entries = [];
			try {
				entries = fs.readdirSync(dir, { withFileTypes: true });
			} catch {
				continue;
			}
			for (const e of entries) {
				const abs = path.resolve(dir, e.name);
				if (e.isDirectory()) {
					stack.push(abs);
					continue;
				}
				if (!e.isFile()) continue;
				const ext = path.extname(e.name).toLowerCase();
				if (!allowed.has(ext)) continue;
				try {
					const st = fs.statSync(abs);
					if (Number(st.size || 0) > 10_000) files.push(abs);
				} catch {}
			}
		}
		return files;
	} catch {
		return [];
	}
}

function loadImageMap(baseDir) {
	const p = path.resolve(baseDir, "image_map.json");
	try {
		const txt = fs.readFileSync(p, "utf8");
		const j = JSON.parse(txt);
		return j && typeof j === "object" ? j : null;
	} catch {
		return null;
	}
}

function normalizeTxt(s) {
	return String(s || "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function toTokens(s) {
	const base = normalizeTxt(s);
	const stop = new Set([
		"ref",
		"boite",
		"pcs",
		"pc",
		"pack",
		"paquet",
		"color",
		"couleur",
		"pen",
		"stylo",
		"set",
		"size",
		"long",
		"short",
		"box",
		"piece",
		"pieces",
		"de",
		"du",
		"la",
		"le",
		"les",
		"and",
		"et",
	]);
	const raw = base.split(" ").filter((t) => t.length > 1 && !stop.has(t));
	const uniq = Array.from(new Set(raw));
	return uniq;
}

function jaccard(a, b) {
	const A = new Set(a);
	const B = new Set(b);
	let inter = 0;
	for (const t of A) if (B.has(t)) inter++;
	const union = A.size + B.size - inter;
	return union === 0 ? 0 : inter / union;
}

function buildSmartImageMap(items, baseDir, existing) {
	const images = listImages(baseDir).map((p) => {
		const base = path.basename(p, path.extname(p));
		const parts = p.split(/[\\/]/).slice(-3);
		const ctxTokens = parts.flatMap((seg) => toTokens(seg));
		return {
			path: p,
			base,
			tokens: Array.from(new Set([...toTokens(base), ...ctxTokens])),
			nums: base.match(/\d{2,}/g) || [],
		};
	});
	const map = { ...(existing || {}) };
	for (const it of items || []) {
		if (!it || !it.id) continue;
		if (map[it.id] && fs.existsSync(map[it.id])) continue;
		const tokens = toTokens(
			`${it.brand || ""} ${it.label || it.name_fr || ""} ${it.id}`,
		);
		const nums =
			String(
				`${it.brand || ""} ${it.label || it.name_fr || ""} ${it.id}`,
			).match(/\d{2,}/g) || [];
		const brandTok = toTokens(it.brand || "");
		let best = null;
		let bestScore = 0;
		for (const im of images) {
			const jScore = jaccard(tokens, im.tokens);
			const numInter = new Set(nums.filter((n) => im.nums.includes(n))).size;
			const numUnion = new Set([...nums, ...im.nums]).size || 1;
			const numScore = numUnion === 0 ? 0 : numInter / numUnion;
			const brandHit =
				brandTok.length && brandTok.some((b) => im.tokens.includes(b)) ? 1 : 0;
			const idHit = String(im.base)
				.toLowerCase()
				.includes(String(it.id).toLowerCase())
				? 1
				: 0;
			const score =
				0.55 * jScore + 0.3 * numScore + 0.1 * brandHit + 0.05 * idHit;
			if (score > bestScore) {
				bestScore = score;
				best = im;
			}
		}
		if (best && bestScore >= 0.28) {
			map[it.id] = best.path;
		}
	}
	return map;
}

function resolveImagePathForItem(baseDir, item, imageMap) {
	const mapped = imageMap?.[item.id] ? imageMap[item.id] : null;
	if (mapped && fs.existsSync(mapped)) return mapped;
	const found = findProductImage(baseDir, item);
	return found || null;
}

function buildAudit(items, baseDir, imageMap) {
	const out = [];
	for (const it of items || []) {
		const img = resolveImagePathForItem(baseDir, it, imageMap);
		out.push({
			id: it.id,
			brand: it.brand || "",
			label: it.label || it.name_fr || "",
			has_image: Boolean(img),
			image_path: img || null,
		});
	}
	return out;
}

function readBrandThemes() {
	const p = path.resolve(process.cwd(), "catalogue", "code.txt");
	try {
		const txt = fs.readFileSync(p, "utf8");
		const j = JSON.parse(txt);
		return j && typeof j === "object" ? j : null;
	} catch {
		return null;
	}
}

function beautyEnabled() {
	try {
		const p = path.resolve(process.cwd(), "catalogue", "beauty.txt");
		fs.accessSync(p);
		return true;
	} catch {
		return false;
	}
}

function buildAutoImageAssignment(items, baseDir) {
	const imgs = listImages(baseDir);
	if (!imgs.length) return {};
	const out = {};
	let i = 0;
	for (const it of items) {
		const pick = imgs[i % imgs.length];
		out[it.id] = pick;
		i++;
	}
	return out;
}

function brandSections(items) {
	const byBrand = new Map();
	for (const it of items) {
		const b = it.brand || "Divers";
		if (!byBrand.has(b)) byBrand.set(b, []);
		byBrand.get(b).push(it);
	}
	const sections = Array.from(byBrand.entries()).map(([brand, arr]) => ({
		brand,
		items: arr,
	}));
	sections.sort((a, b) => String(a.brand).localeCompare(String(b.brand)));
	return sections;
}

function readBrandPriority() {
	const p = path.resolve(process.cwd(), "catalogue", "brand_priority.json");
	try {
		const txt = fs.readFileSync(p, "utf8");
		const arr = JSON.parse(txt);
		return Array.isArray(arr)
			? arr.map((s) => String(s).trim().toUpperCase())
			: [];
	} catch {
		return [];
	}
}

function orderSections(sections, priority) {
	if (!Array.isArray(priority) || priority.length === 0) return sections;
	const pset = new Set(priority);
	const featured = sections.filter((s) =>
		pset.has(String(s.brand).toUpperCase()),
	);
	const rest = sections.filter((s) => !pset.has(String(s.brand).toUpperCase()));
	featured.sort(
		(a, b) =>
			priority.indexOf(String(a.brand).toUpperCase()) -
			priority.indexOf(String(b.brand).toUpperCase()),
	);
	rest.sort((a, b) => String(a.brand).localeCompare(String(b.brand)));
	return [...featured, ...rest];
}

function cardFor(baseDir, p, opts = {}, imageMap) {
	const mapped = imageMap?.[p.id] ? imageMap[p.id] : null;
	const imgPath = mapped || findProductImage(baseDir, p);
	const imgSrc = imgPath ? toFileUrl(imgPath) : placeholderImage(p.label);
	const pills = p.variants?.length
		? `<div class="meta">${p.variants
				.map(
					(v) =>
						`<span class="pill">${v.kind}: ${String(v.value)
							.replace(/"/g, "")
							.toUpperCase()}</span>`,
				)
				.join("")}</div>`
		: "";
	const price =
		opts.showPrice && p.price
			? `<div class="price">Prix de vente: ${p.price}</div>`
			: `<div class="price">Prix: réservé (à remplir)</div>`;
	return (
		`<div class="card">` +
		`<div class="img"><img alt="${p.label}" src="${imgSrc}"/>` +
		(opts.showPrice && p.price
			? `<div class="overlay-price">Prix de vente: ${p.price}</div>`
			: "") +
		`</div>` +
		`<div class="content">` +
		`<div class="col fr"><h3 class="name">${p.brand || ""} — ${p.name_fr || p.label}</h3>${pills}${price}<div class="ref">Référence: ${p.id}</div></div>` +
		`<div class="col ar"><h3 class="name">${p.name_ar || ""}</h3>${pills}${price.replace("Prix de vente:", "السعر:").replace("Prix:", "السعر:")}<div class="ref">المرجع: ${p.id}</div></div>` +
		`</div>` +
		`</div>`
	);
}

function buildHtml(master, electronics, baseDir, imageMapGlobal) {
	const be = beautyEnabled();
	const gap = be ? 16 : 14;
	const imgH = be ? 200 : 180;
	const radius = be ? 18 : 16;
	const shadow = be
		? "0 6px 18px rgba(0,0,0,0.08)"
		: "0 3px 10px rgba(0,0,0,0.06)";
	const dividerPad = be ? "16px 18px" : "14px 16px";
	const nameSize = be ? 20 : 18;
	const css =
		"html,body{margin:0;background:#f7f7fa;color:#0e1118}" +
		"body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif}" +
		".cover{height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:radial-gradient(1200px 500px at 20% -100%,#1a1f3b 0%,transparent 70%),radial-gradient(1200px 500px at 100% -120%,#10202f 0%,transparent 70%);color:#ecf2ff}" +
		".cover h1{font-size:44px;margin:8px 0}" +
		".cover p{color:#cbd3df}" +
		".toc{page-break-after:always;padding:28px}" +
		".toc h2{margin:0 0 14px;font-weight:700;color:#0d1425}" +
		".toc ul{list-style:none;padding:0;margin:0}" +
		".toc li{margin:6px 0}" +
		".page{padding:20px;page-break-after:always;max-width:180mm;margin:0 auto}" +
		`.divider{margin:10px 0 18px;padding:${dividerPad};border-radius:14px;border:1px solid #1e2532;display:flex;align-items:center;gap:12px}` +
		".divider .logo{height:26px;display:inline-block}" +
		`.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:${gap}px;align-items:start}` +
		`.card{background:#fff;border:1px solid #dfe6f3;border-radius:${radius}px;overflow:hidden;box-shadow:${shadow};display:flex;flex-direction:column}` +
		".img{background:#11182a;position:relative}" +
		`.img img{width:100%;height:${imgH}px;object-fit:contain;display:block;background:#0f1a34}` +
		".overlay-price{position:absolute;right:10px;bottom:10px;background:rgba(22,38,58,0.85);color:#eaf1ff;border:1px solid #2a3e58;border-radius:10px;padding:6px 10px;font-size:12px}" +
		".content{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:12px 14px}" +
		".col{border:1px solid #e8eef8;border-radius:12px;padding:10px;background:#f9fbff}" +
		`.name{margin:0 0 4px;font-size:${nameSize}px;color:#0d1425;font-weight:700}` +
		".ref{margin-top:6px;font-size:10px;color:#6b7c99}" +
		".fr{direction:ltr;text-align:left}" +
		".ar{direction:rtl;text-align:right}" +
		".meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}" +
		".pill{display:inline-flex;padding:4px 10px;border-radius:999px;background:#eef3fb;border:1px solid #d6e0f2;color:#21406a;font-size:12px}" +
		".price{margin-top:10px;padding:8px;border:2px dashed #cfd8ea;border-radius:12px;background:#fafcff;color:#7c8aa5;font-size:12px}" +
		".footer{margin-top:6px;font-size:12px;color:#6b7c99}" +
		"@page{size:A4;margin:12mm}" +
		"@media print{.grid{break-inside:avoid;page-break-inside:avoid}.card{break-inside:avoid;page-break-inside:avoid}.divider{break-inside:avoid}.cover{break-after:page}.toc{break-after:page}.page{break-after:page}}";
	const themes = readBrandThemes() || {};
	const priority = readBrandPriority();
	const sections = orderSections(brandSections(master.items), priority);
	const electronicsSections =
		electronics && Array.isArray(electronics.items)
			? orderSections(brandSections(electronics.items), priority)
			: [];
	const pages = sections
		.map((sec) => {
			const imageMap =
				imageMapGlobal || buildAutoImageAssignment(sec.items, baseDir);
			const cards = sec.items
				.map((p) => cardFor(baseDir, p, { showPrice: false }, imageMap))
				.join("");
			const anchor = slugify(`brand-${sec.brand}`);
			const t =
				themes[String(sec.brand || "").toUpperCase()] ||
				themes[String(sec.brand || "")] ||
				{};
			const bg = t.primary_color || "#0e1118";
			const fg = "#ffffff";
			const logo =
				t.logo_path && fs.existsSync(path.resolve(process.cwd(), t.logo_path))
					? toFileUrl(path.resolve(process.cwd(), t.logo_path))
					: "";
			const logoHtml = logo
				? `<img class="logo" src="${logo}" alt="${sec.brand} logo"/>`
				: "";
			return `<div class="page" id="${anchor}"><div class="divider" style="background:${bg};color:${fg};border-color:${bg}${beautyEnabled() ? `;background-image:linear-gradient(90deg,${bg} 0%,rgba(255,255,255,0.06) 100%)` : ""}">${logoHtml}<div style="font-weight:800">Marque: ${sec.brand}</div></div><div class="grid">${cards}</div></div>`;
		})
		.join("");
	const cover = `<section class="cover"><h1>Atlas Fournitures</h1><p>Catalogue illustré (FR + AR) — Prix réservés</p></section>`;
	const tocBrands = sections
		.map(
			(s) =>
				`<li><a href="#${slugify(`brand-${s.brand}`)}">${s.brand} (${s.items.length})</a></li>`,
		)
		.join("");
	const tocElectronics = electronicsSections
		.map(
			(s) =>
				`<li><a href="#${slugify(`elec-${s.brand}`)}">${s.brand} (${s.items.length})</a></li>`,
		)
		.join("");
	const toc =
		`<section class="toc"><h2>Sommaire</h2><h3>Mobilier</h3><ul>${tocBrands}</ul>` +
		(electronicsSections.length
			? `<h3>Électronique</h3><ul>${tocElectronics}</ul>`
			: "") +
		`</section>`;
	const pagesElectronics =
		electronicsSections
			.map((sec) => {
				const imageMap =
					imageMapGlobal || buildAutoImageAssignment(sec.items, baseDir);
				const cards = sec.items
					.map((p) => cardFor(baseDir, p, { showPrice: true }, imageMap))
					.join("");
				const anchor = slugify(`elec-${sec.brand}`);
				const t =
					themes[String(sec.brand || "").toUpperCase()] ||
					themes[String(sec.brand || "")] ||
					{};
				const bg = t.primary_color || "#16263a";
				const fg = "#ffffff";
				const logo =
					t.logo_path && fs.existsSync(path.resolve(process.cwd(), t.logo_path))
						? toFileUrl(path.resolve(process.cwd(), t.logo_path))
						: "";
				const logoHtml = logo
					? `<img class="logo" src="${logo}" alt="${sec.brand} logo"/>`
					: "";
				return `<div class="page" id="${anchor}"><div class="divider" style="background:${bg};color:${fg};border-color:${bg}${beautyEnabled() ? `;background-image:linear-gradient(90deg,${bg} 0%,rgba(255,255,255,0.06) 100%)` : ""}">${logoHtml}<div style="font-weight:800">Électronique — Marque: ${sec.brand}</div></div><div class="grid">${cards}</div></div>`;
			})
			.join("") || "";
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Atlas Fournitures — Catalogue</title><style>${css}</style></head><body>${cover}${toc}${pages}${pagesElectronics}</body></html>`;
}

function buildSectionHtml(kind, brand, items, baseDir, imageMapGlobal) {
	const be = beautyEnabled();
	const gap = be ? 14 : 12;
	const imgH = be ? 190 : 170;
	const radius = be ? 14 : 12;
	const shadow = be
		? "0 4px 12px rgba(0,0,0,0.08)"
		: "0 2px 6px rgba(0,0,0,0.06)";
	const nameSize = be ? 18 : 16;
	const css =
		"html,body{margin:0;background:#f7f7fa;color:#0e1118}" +
		"body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif}" +
		".page{padding:16px;max-width:180mm;margin:0 auto}" +
		".divider{margin:10px 0 18px;padding:12px 14px;border-radius:12px;border:1px solid #1e2532;display:flex;align-items:center;gap:10px}" +
		".divider .logo{height:24px;display:inline-block}" +
		`.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:${gap}px}` +
		`.card{background:#fff;border:1px solid #dfe6f3;border-radius:${radius}px;overflow:hidden;box-shadow:${shadow};display:flex;flex-direction:column}` +
		`.img{background:#11182a;position:relative}.img img{width:100%;height:${imgH}px;object-fit:contain;display:block}` +
		".overlay-price{position:absolute;right:8px;bottom:8px;background:rgba(22,38,58,0.85);color:#eaf1ff;border:1px solid #2a3e58;border-radius:8px;padding:6px 8px;font-size:12px}" +
		".content{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:10px}" +
		".col{border:1px solid #e8eef8;border-radius:8px;padding:8px;background:#f9fbff}" +
		`.name{margin:0 0 4px;font-size:${nameSize}px;color:#0d1425;font-weight:600}` +
		".ref{margin-top:6px;font-size:10px;color:#6b7c99}" +
		".fr{direction:ltr;text-align:left}" +
		".ar{direction:rtl;text-align:right}" +
		".meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}" +
		".pill{display:inline-flex;padding:4px 8px;border-radius:999px;background:#eef3fb;border:1px solid #d6e0f2;color:#21406a;font-size:12px}" +
		".price{margin-top:8px;padding:6px;border:2px dashed #cfd8ea;border-radius:8px;background:#fafcff;color:#7c8aa5;font-size:12px}" +
		"@page{size:A4;margin:12mm}" +
		"@media print{.grid{break-inside:avoid;page-break-inside:avoid}.card{break-inside:avoid;page-break-inside:avoid}.divider{break-inside:avoid}.page{break-after:page}}";
	const themes = readBrandThemes() || {};
	const showPrice = kind === "electronics";
	const imageMap = imageMapGlobal || buildAutoImageAssignment(items, baseDir);
	const cards = items
		.map((p) => cardFor(baseDir, p, { showPrice }, imageMap))
		.join("");
	const anchor = slugify(`${kind}-${brand}`);
	const t =
		themes[String(brand || "").toUpperCase()] ||
		themes[String(brand || "")] ||
		{};
	const bg = t.primary_color || (showPrice ? "#16263a" : "#0e1118");
	const fg = "#ffffff";
	const logo =
		t.logo_path && fs.existsSync(path.resolve(process.cwd(), t.logo_path))
			? toFileUrl(path.resolve(process.cwd(), t.logo_path))
			: "";
	const logoHtml = logo
		? `<img class="logo" src="${logo}" alt="${brand} logo"/>`
		: "";
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${brand}</title><style>${css}</style></head><body><div class="page" id="${anchor}"><div class="divider" style="background:${bg};color:${fg};border-color:${bg}${beautyEnabled() ? `;background-image:linear-gradient(90deg,${bg} 0%,rgba(255,255,255,0.06) 100%)` : ""}">${logoHtml}<div style="font-weight:800">${showPrice ? "Électronique — Marque: " : "Marque: "}${brand}</div></div><div class="grid">${cards}</div></div></body></html>`;
}

function findEdge() {
	const candidates = [
		"C:\\\\Program Files\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe",
		"C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe",
	];
	for (const c of candidates) {
		try {
			fs.accessSync(c);
			return c;
		} catch {}
	}
	return null;
}

function main() {
	const args = parseArgs(process.argv);
	const root = process.cwd();
	const outDir = args.outDir
		? path.resolve(root, args.outDir)
		: path.resolve(root, "catalogue");
	const masterPath = args.master
		? path.resolve(root, args.master)
		: path.resolve(root, "catalogue", "catalogue_master.json");
	const outHtml = path.resolve(outDir, "catalogue_full.html");
	const master = readJson(masterPath);
	let electronics = readJson(
		args.electronics
			? path.resolve(root, args.electronics)
			: path.resolve(root, "catalogue", "catalogue_electronics.json"),
	);
	if (!electronics) {
		const alt = readJsonIfExists(
			path.resolve(outDir, "images_photos", "products.json"),
		);
		if (Array.isArray(alt)) {
			const items = alt.map((x, i) => ({
				id: String(x.id || `ELEC-${i + 1}`),
				brand: x.brand || "",
				name_fr: x.name_fr || x.name || "",
				name_ar: x.name_ar || "",
				label: x.name_fr || x.name || "",
				variants: [],
				price: null,
			}));
			electronics = { items };
		}
	}
	if (!master || !Array.isArray(master.items)) {
		throw new Error("Master product list missing or invalid");
	}
	const baseDirArg = args.baseDir ? path.resolve(root, args.baseDir) : null;
	let baseDir = baseDirArg
		? baseDirArg
		: fs.existsSync(path.resolve(outDir, "images_photos"))
			? path.resolve(outDir, "images_photos")
			: outDir;
	if (args.imagesZip && typeof args.imagesZip === "string") {
		const zipPath = path.resolve(root, args.imagesZip);
		const importDir = path.resolve(outDir, "images_imported");
		try {
			spawnSync(
				"powershell",
				[
					"-NoProfile",
					"-Command",
					`Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${importDir}' -Force`,
				],
				{ stdio: "ignore" },
			);
			if (fs.existsSync(importDir)) {
				baseDir = importDir;
			}
		} catch {}
	}
	const existingMap = loadImageMap(baseDir) || {};
	const smartMap = buildSmartImageMap(
		[...(master.items || []), ...(electronics.items || [])],
		baseDir,
		existingMap,
	);
	writeText(
		path.resolve(outDir, "image_map.json"),
		JSON.stringify(smartMap, null, 2),
	);
	const html = buildHtml(master, electronics, baseDir, smartMap);
	writeText(outHtml, html);
	const priority = readBrandPriority();
	const furnitureSections = orderSections(
		brandSections(master.items),
		priority,
	);
	const electronicsSections =
		electronics && Array.isArray(electronics.items)
			? orderSections(brandSections(electronics.items), priority)
			: [];
	const sectionsDir = path.resolve(outDir, "sections");
	const pdfDir = path.resolve(outDir, "pdfs");
	ensureDir(path.join(sectionsDir, "x"));
	ensureDir(path.join(pdfDir, "x"));
	const manifest = [];
	for (const sec of furnitureSections) {
		const slug = slugify(`brand-${sec.brand}`);
		const sHtml = path.join(sectionsDir, `${slug}.html`);
		const sPdf = path.join(pdfDir, `${slug}.pdf`);
		const htmlStr = buildSectionHtml(
			"brand",
			sec.brand,
			sec.items,
			baseDir,
			smartMap,
		);
		writeText(sHtml, htmlStr);
		manifest.push({
			type: "furniture",
			brand: sec.brand,
			anchor: slug,
			html: sHtml,
			pdf: sPdf,
			count: sec.items.length,
		});
	}
	for (const sec of electronicsSections) {
		const slug = slugify(`elec-${sec.brand}`);
		const sHtml = path.join(sectionsDir, `${slug}.html`);
		const sPdf = path.join(pdfDir, `${slug}.pdf`);
		const htmlStr = buildSectionHtml(
			"electronics",
			sec.brand,
			sec.items,
			baseDir,
			smartMap,
		);
		writeText(sHtml, htmlStr);
		manifest.push({
			type: "electronics",
			brand: sec.brand,
			anchor: slug,
			html: sHtml,
			pdf: sPdf,
			count: sec.items.length,
		});
	}
	writeText(
		path.resolve(outDir, "catalogue_manifest.json"),
		JSON.stringify({ full_html: outHtml, sections: manifest }, null, 2),
	);
	const audit = {
		furniture: buildAudit(master.items, baseDir, smartMap),
		electronics: buildAudit(electronics.items || [], baseDir, smartMap),
	};
	writeText(
		path.resolve(outDir, "image_audit.json"),
		JSON.stringify(audit, null, 2),
	);
	const edge = findEdge();
	const noPdf =
		args.noPdf === true || String(args.noPdf || "").toLowerCase() === "true";
	if (edge && !noPdf) {
		const outPdf = path.resolve(outDir, "catalogue_full.pdf");
		spawnSync(
			edge,
			[
				"--headless",
				"--disable-gpu",
				`--print-to-pdf=${outPdf}`,
				toFileUrl(outHtml),
			],
			{ stdio: "ignore" },
		);
	}
	if (edge && !noPdf) {
		for (const entry of manifest) {
			const url = toFileUrl(entry.html);
			const res = spawnSync(
				edge,
				["--headless", "--disable-gpu", `--print-to-pdf=${entry.pdf}`, url],
				{
					stdio: "ignore",
				},
			);
			if (res.error) {
				process.stderr.write(
					`${JSON.stringify({
						ok: false,
						error: String(res.error?.message || res.error),
						brand: entry.brand,
					})}\n`,
				);
			}
		}
	}
	process.stdout.write(
		`${JSON.stringify({
			ok: true,
			outHtml,
			count: master.items.length,
			sections: manifest.length,
			edge: Boolean(edge),
			pdf: Boolean(edge && !noPdf),
			outDir,
			audit: {
				furniture_missing: audit.furniture.filter((x) => !x.has_image).length,
				electronics_missing: audit.electronics.filter((x) => !x.has_image)
					.length,
			},
		})}\n`,
	);
}

main();
