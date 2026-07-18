import fs from "fs";
import path from "path";

function readJson(p) {
	try {
		const t = fs.readFileSync(p, "utf8");
		return JSON.parse(t);
	} catch {
		return null;
	}
}

function listCandidates(dirs) {
	const out = [];
	const exts = new Set([".jpg", ".jpeg", ".png", ".webp"]);
	for (const d of dirs) {
		try {
			const es = fs.readdirSync(d, { withFileTypes: true });
			for (const e of es) {
				if (!e.isFile()) continue;
				const ext = path.extname(e.name).toLowerCase();
				if (!exts.has(ext)) continue;
				const abs = path.resolve(d, e.name);
				try {
					const st = fs.statSync(abs);
					if ((st.size || 0) < 8000) continue;
					out.push(abs);
				} catch {}
			}
		} catch {}
	}
	return out;
}

function norm(s) {
	return String(s || "").toLowerCase();
}

function tokenize(s) {
	const a = [];
	const x = String(s || "")
		.replace(/[^a-z0-9]+/gi, " ")
		.split(/\s+/)
		.map((t) => t.trim().toLowerCase())
		.filter((t) => t.length >= 3);
	for (const t of x) a.push(t);
	return a;
}

function numericTokens(s) {
	const m = String(s || "").match(/\b[0-9]{4,}\b/g);
	return m ? m.map((x) => x.toLowerCase()) : [];
}

function scoreFor(item, file) {
	const base = path.basename(file).toLowerCase();
	let basePlus = base;
	const m = base.match(/_na1fn_([A-Za-z0-9_-]+)/);
	if (m && m[1]) {
		try {
			const b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
			const buf = Buffer.from(b64, "base64");
			const txt = buf.toString("utf8").toLowerCase();
			basePlus += " " + txt;
		} catch {}
	}
	const toks = new Set([
		...tokenize(item.brand || ""),
		...tokenize(item.name_fr || item.label || ""),
		...numericTokens(item.name_fr || item.label || ""),
		...numericTokens(item.ref || ""),
	]);
	let score = 0;
	for (const t of toks) {
		if (!t) continue;
		if (basePlus.includes(t)) score += t.length >= 6 ? 3 : 1;
	}
	if (item.id && base.includes(String(item.id).toLowerCase())) score += 5;
	return score;
}

function pickBest(item, candidates) {
	let best = null;
	let bestScore = 0;
	for (const c of candidates) {
		const sc = scoreFor(item, c);
		if (sc > bestScore) {
			bestScore = sc;
			best = c;
		}
	}
	if (bestScore >= 2) return best;
	return null;
}

function main() {
	const roots = [process.cwd(), path.resolve(process.cwd(), "..")];
	let root = roots.find((r) => {
		try {
			return fs.existsSync(path.resolve(r, "catalogue"));
		} catch {
			return false;
		}
	});
	if (!root) root = process.cwd();
	const master = readJson(
		path.resolve(root, "catalogue", "catalogue_master.json"),
	);
	let electronics = readJson(
		path.resolve(root, "catalogue", "catalogue_electronics.json"),
	);
	if (!electronics) {
		const alt = readJson(
			path.resolve(root, "catalogue", "images_photos", "products.json"),
		);
		if (Array.isArray(alt)) {
			const items = alt.map((x, i) => ({
				id: String(x.id || `ELEC-${i + 1}`),
				brand: x.brand || "",
				name_fr: x.name_fr || x.name || "",
				label: x.name_fr || x.name || "",
				ref: x.ref || "",
			}));
			electronics = { items };
		}
	}
	if (!master || !Array.isArray(master.items)) {
		process.stderr.write("master missing\n");
		process.exitCode = 1;
		return;
	}
	const dirs = [
		path.resolve(root, "catalogue", "images_photos"),
		path.resolve(root, "catalogue"),
	];
	const candidates = listCandidates(dirs);
	const map = {};
	const audit = [];
	const brandColors = {
		bic: "#ff7f00",
		pilot: "#003b6f",
		deli: "#d21f3c",
		uhu: "#ffef00",
		accord: "#0b6fa4",
		express: "#b3221f",
		"top sam": "#1f6fb3",
		maped: "#e53935",
		casio: "#1a49a0",
		samsung: "#1428a0",
		kioxia: "#6e1d77",
		foneng: "#0a9158",
		r8: "#3a3a3a",
		"damane gold": "#c29a2d",
	};
	function placeholderPath(id) {
		const dir = path.resolve(root, "catalogue", "generated_placeholders");
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
		return path.resolve(dir, `${id}.svg`);
	}
	function writePlaceholder(item) {
		const color = brandColors[norm(item.brand)] || "#2a3e58";
		const p = placeholderPath(item.id);
		const title = (item.brand || "").slice(0, 24);
		const name = (item.name_fr || item.label || "").slice(0, 64);
		const svg =
			`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">` +
			`<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${color}"/><stop offset="100%" stop-color="#11182a"/></linearGradient></defs>` +
			`<rect width="100%" height="100%" rx="24" fill="url(#g)"/>` +
			`<text x="50%" y="42%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-family="system-ui,Segoe UI,Roboto" font-size="64" font-weight="700">${title}</text>` +
			`<text x="50%" y="60%" dominant-baseline="middle" text-anchor="middle" fill="#eaf1ff" font-family="system-ui,Segoe UI,Roboto" font-size="32">${name}</text>` +
			`</svg>`;
		fs.writeFileSync(p, svg);
		return p;
	}
	const all = [...master.items, ...(electronics?.items || [])];
	for (const it of all) {
		const best = pickBest(it, candidates);
		if (best) {
			map[it.id] = best;
			audit.push({
				id: it.id,
				brand: it.brand || "",
				ref: it.ref || "",
				image: best,
				status: "wired",
			});
		} else {
			const ph = writePlaceholder(it);
			map[it.id] = ph;
			audit.push({
				id: it.id,
				brand: it.brand || "",
				ref: it.ref || "",
				image: ph,
				status: "generated",
			});
		}
	}
	const outMap = path.resolve(root, "catalogue", "image_map.json");
	fs.writeFileSync(outMap, JSON.stringify(map, null, 2));
	const outAudit = path.resolve(root, "catalogue", "image_audit.json");
	fs.writeFileSync(outAudit, JSON.stringify(audit, null, 2));
	process.stdout.write(
		JSON.stringify({
			ok: true,
			image_map: outMap,
			audit: outAudit,
			candidates: candidates.length,
		}) + "\n",
	);
}

main();
