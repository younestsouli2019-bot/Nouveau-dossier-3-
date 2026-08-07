import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url)) + "/..";
const STATIC = join(ROOT, ".vercel", "output", "static");
const COURSES_DIR = join(STATIC, "assets", "courses");
const CATALOG_JSON = join(STATIC, "data", "catalog.json");

function hashStr(s) {
	let h = 5381;
	for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
	return h;
}

const escapeXml = (s) =>
	String(s)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");

const KEYWORDS = [
	["Security", /(security|siem|soc|incident|threat|hack|offensive|penetration|cyber|red team|defens|oscp|ceh|ejpt|ecppt|pnpt|bscp|ccna|ccnp|cisco|juniper|comptia|giac|splunk|elastic|sentinel|palo alto|fortinet|nccer)/i],
	["Cloud", /(cloud|aws|azure|gcp|data center|databricks|kubernetes|openstack|vmware)/i],
	["Data & AI", /(ai|machine learning|ml|data|analytics|genai|generative|rag|llm|python|tensorflow)/i],
	["Engineering", /(engineering|engineer|architecture|developer|software|programming|code|automation|devops|network|telecom)/i],
	["Finance", /(finance|financial|risk|investment|accounting|tax|trader|trading|certified public|bank)/i],
	["Health", /(health|medical|nursing|nurse|pharm|physician|surgeon|dental|anatomy|anatomical)/i],
	["Management", /(management|project|product|agile|scrum|prince|pmp|human resources|leadership)/i],
	["Safety & Ops", /(safety|osha|operator|maintenance|construction|crane|forklift|plumb|electrical|welding|rigger|fall protection)/i],
	["Automotive", /(automotive|auto|vehicle|mechanical|diesel|car)/i],
	["Education", /(teaching|teacher|education|language|ielts|toefl|tutor|exam|test)/i],
	["Law & Real Estate", /(law|legal|real estate|property|license|notary|broker|apprais)/i],
	["Quantum & Research", /(quantum|research|science|physics|math|chemistry|biology|botanical)/i],
];

function categoryFor(title) {
	for (const [label, re] of KEYWORDS) {
		if (re.test(title)) return label;
	}
	return "";
}

function splitTitle(title, maxLen) {
	const words = String(title).split(/\s+/);
	const lines = [];
	let cur = "";
	for (const w of words) {
		if ((cur + " " + w).trim().length > maxLen && cur) {
			lines.push(cur.trim());
			cur = w;
		} else {
			cur = (cur + " " + w).trim();
		}
	}
	if (cur) lines.push(cur.trim());
	return lines;
}

function bannerSvg(slug, title, subtitle, variant = 0) {
	const h = hashStr(slug + "::" + variant);
	const hue = h % 360;
	const sat = 58 + (hashStr(slug + "s") % 16);
	const l1 = 40 + (hashStr(slug + "l") % 14);
	const hue2 = (hue + 28 + (h % 52)) % 360;
	const l2 = Math.max(34, l1 - 9);
	const angle = 12 + (variant * 26) % 48;

	const cat = categoryFor(title);
	const lines = splitTitle(title, 34);
	const fs = lines.length === 1 ? 26 : lines.length === 2 ? 21 : lines.length === 3 ? 17 : 15;
	const lineH = Math.round(fs * 1.28);
	const n = lines.length;
	const startY = 118 - ((n - 1) * lineH) / 2;

	const titleEls = lines
		.map((ln, i) => `<text x="280" y="${Math.round(startY + i * lineH)}" font-size="${fs}" font-weight="700" fill="#ffffff">${escapeXml(ln)}</text>`)
		.join("");

	const pill =
		cat.length > 0
			? `<g><rect x="20" y="18" rx="999" width="${cat.length * 7.4 + 22}" height="22" fill="rgba(0,0,0,0.28)"/><text x="${20 + cat.length * 3.7 + 11}" y="33" font-size="11" fill="rgba(255,255,255,0.95)" letter-spacing="1" text-anchor="middle">${escapeXml(cat.toUpperCase())}</text></g>`
			: "";

	const sub = subtitle
		? `<text x="280" y="${Math.round(startY + n * lineH + 14)}" font-size="14" fill="rgba(255,255,255,0.85)">${escapeXml(subtitle)}</text>`
		: "";

	return `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="240" viewBox="0 0 560 240">
  <defs>
    <linearGradient id="g${variant}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl(${hue},${sat}%,${l1}%)"/>
      <stop offset="100%" stop-color="hsl(${hue2},${sat}%,${l2}%)"/>
    </linearGradient>
    <radialGradient id="glow${variant}" cx="0.15" cy="0.1" r="0.9">
      <stop offset="0%" stop-color="rgba(255,255,255,0.22)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
    </radialGradient>
  </defs>
  <rect width="560" height="240" rx="16" fill="url(#g${variant})" transform="rotate(${angle} 280 120) scale(1.25)"/>
  <rect width="560" height="240" rx="16" fill="url(#glow${variant})"/>
  <circle cx="468" cy="190" r="86" fill="rgba(255,255,255,0.07)"/>
  <circle cx="500" cy="150" r="40" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="2"/>
  ${pill}
  <text x="538" y="32" font-size="11" fill="rgba(255,255,255,0.78)" text-anchor="end" letter-spacing="1">RealWorldCerts</text>
  <g font-family="system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif" text-anchor="middle">
    ${titleEls}
    ${sub}
  </g>
</svg>
`;
}

function loadCatalog() {
	return JSON.parse(readFileSync(CATALOG_JSON, "utf8"));
}

function genImages() {
	const { items } = loadCatalog();
	const seen = new Set();
	let written = 0;
	for (const it of items) {
		const slug = String(it.slug || "").trim();
		if (!slug || seen.has(slug)) continue;
		seen.add(slug);
		const title = String(it.title || slug);
		const subtitle = it.practiceTestCount
			? `${it.practiceTestCount} practice questions`
			: it.lectureCount
				? `${it.lectureCount} lectures`
				: "";
		const variants = [
			[slug + ".svg", 0],
			[slug + "-b.svg", 1],
			[slug + "-c.svg", 2],
		];
		for (const [name, v] of variants) {
			writeFileSync(join(COURSES_DIR, name), bannerSvg(slug, title, subtitle, v), "utf8");
			written++;
		}
	}
	console.log(`genImages: wrote ${written} SVG files for ${seen.size} unique slugs`);
}

const SRC_RE = /src="data:image\/svg\+xml;charset=utf-8,[^"]*"/g;
const CARD_RE = /<a class="card" href="\/catalog\/([^"]+)\.html"[\s\S]*?<\/a>/g;

function wireCards(html, prefix) {
	return html.replace(CARD_RE, (block, slug) => {
		let out = block.replace(SRC_RE, (m, idx, full) => {
			const prefixIdx = full.indexOf("src=");
			if (prefixIdx < 0) return m;
			return `src="${prefix}${slug}.svg" loading="lazy"`;
		});
		if (!out.includes("loading=")) {
			out = out.replace(/<img/, '<img loading="lazy"');
		}
		return out;
	});
}

function wireCoursePage(html, slug) {
	const variants = [slug + ".svg", slug + "-b.svg", slug + "-c.svg"];
	let i = 0;
	return html.replace(SRC_RE, () => `src="/assets/courses/${variants[i++ % variants.length]}"`);
}

function wireCheckoutLinks(html, slug, title) {
	const q = `?course=${encodeURIComponent(title)}&slug=${slug}`;
	return html.replace(
		/href="\/checkout\/(paypal|payoneer|crypto|bank)\.html"/g,
		`href="/checkout/$1.html${q}"`,
	);
}

function wire() {
	const { items } = loadCatalog();
	const slugMap = new Map();
	for (const it of items) {
		const slug = String(it.slug || "").trim();
		if (!slug) continue;
		if (!slugMap.has(slug)) {
			slugMap.set(slug, { title: it.title, image: `/assets/courses/${slug}.svg` });
		}
	}

	// catalog.json: add image field
	for (const it of items) {
		const slug = String(it.slug || "").trim();
		if (!slug) continue;
		it.image = `/assets/courses/${slug}.svg`;
	}
	writeFileSync(CATALOG_JSON, JSON.stringify({ items }, null, 2), "utf8");
	console.log(`wire: catalog.json updated (${items.length} items)`);

	// Card-bearing files
	const cardFiles = [
		join(STATIC, "catalog", "index.html"),
		join(STATIC, "cybersecurity.html"),
		join(STATIC, "practice.html"),
		...readdirSync(join(STATIC, "bundles"))
			.filter((f) => f.endsWith(".html"))
			.map((f) => join(STATIC, "bundles", f)),
		join(STATIC, "bounty", "index.html"),
	];
	for (const f of cardFiles) {
		if (!existsSync(f)) continue;
		const before = readFileSync(f, "utf8");
		const after = wireCards(before, "/assets/courses/");
		if (after !== before) {
			writeFileSync(f, after, "utf8");
			console.log(`wire: cards updated -> ${basename(f)}`);
		}
	}

	// Course pages
	let pages = 0;
	for (const slug of slugMap.keys()) {
		const f = join(STATIC, "catalog", `${slug}.html`);
		if (!existsSync(f)) continue;
		const before = readFileSync(f, "utf8");
		const after = wireCheckoutLinks(wireCoursePage(before, slug), slug, slugMap.get(slug).title);
		if (after !== before) {
			writeFileSync(f, after, "utf8");
			pages++;
		}
	}
	console.log(`wire: updated ${pages} course pages (images + checkout links)`);
}

const arg = process.argv[2] || "all";
if (arg === "gen" || arg === "all") genImages();
if (arg === "wire" || arg === "all") wire();
