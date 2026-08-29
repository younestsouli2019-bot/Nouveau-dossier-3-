import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
	MediaContract,
	PLACEHOLDER_PATTERNS,
	MIME_OK,
} from "./course-media-contract.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "data", "out");
const REGISTRY_FILE = path.join(OUT_DIR, "course-asset-registry.json");
const ASSETS_LOCAL = path.join(ROOT, "data", "generated");
const MANIFEST = path.join(OUT_DIR, "asset_manifest.json");

export const ASSET_KINDS = ["HERO", "THUMB", "MOD", "DIAGRAM", "TRAILER", "LESSON", "CHEAT"];

function parseArgs(argv) {
	const a = {};
	for (let i = 2; i < argv.length; i++) {
		const k = argv[i];
		if (!k.startsWith("--")) continue;
		const v = argv[i + 1];
		if (v && !v.startsWith("--")) { a[k.slice(2)] = v; i++; }
		else a[k.slice(2)] = true;
	}
	return a;
}

function safeSlug(s) {
	return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

function courseCode(slug) {
	const m = safeSlug(slug);
	if (!m) return "GEN";
	const parts = m.split("-").filter(Boolean);
	const prefix = (parts[0] || "RW").slice(0, 3).replace(/-/g, "").toUpperCase();
	const num = Math.abs(crc32(m)) % 1000;
	return `RWC-${prefix}-${String(num).padStart(3, "0")}`;
}

function crc32(s) {
	let c, table = [];
	for (let n = 0; n < 256; n++) {
		c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c;
	}
	let crc = 0 ^ -1;
	for (let i = 0; i < s.length; i++) crc = (crc >>> 8) ^ table[(crc ^ s.charCodeAt(i)) & 0xff];
	return (crc ^ -1) >>> 0;
}

const KIND_PROMPT = {
	HERO: ({ title, category }) => `Wide cinematic course hero banner for a professional online training course titled "${title}" (${category}). Bold typography-safe negative space on the left, subject illustration on the right. Premium corporate education, high detail, no text in the image, no watermark, 16:9.`,
	THUMB: ({ title, category }) => `Compact square course thumbnail card for "${title}" (${category}). Single strong subject icon on a vibrant gradient, rounded, modern micro-learning UI thumb. No text, no watermark, 1:1.`,
	MOD: ({ title, module }) => `Educational module illustration for "${title}" — module: ${module}. Clean flat-vector diagram-style graphic, one central concept, subtle supporting elements. No text, no watermark.`,
	DIAGRAM: ({ title, topic }) => `Technical diagram for "${title}" — topic: ${topic}. Clean labeled flow/architecture diagram, boxes and arrows, monochrome-on-white with one accent color. Legible, sparse, vector. No capture text (no readable words needed).`,
	CHEAT: ({ title }) => `Clean study cheat-sheet background art for "${title}" — abstract organized grids and sections, subtle, no actual text content. Professional.`,
};

const NO_KEY_REASONS = {
	image: "IMAGE_GEN_API_KEY is not set. Generate cannot proceed without a real image provider key.",
	video: "No video provider key (VIDEO_GEN_API_KEY / REPLICATE_API_TOKEN / GOOGLE_AI_STUDIO_KEY) is set. Trailer/lesson video production is FAIL-CLOSED; refusing to fabricate placeholder videos.",
	storage: "No public asset host configured (ASSET_BASE_URL empty AND no upload endpoint). Generated asset would not be HTTP-200 verifiable; refusing to fake publishing.",
};

function requireImageKey() {
	const k = process.env.IMAGE_GEN_API_KEY || process.env.OPENROUTER_API_KEY;
	if (!k) throw new Error(NO_KEY_REASONS.image);
	return k;
}

/**
 * Resolve the image provider from whichever real key is present.
 * Together (IMAGE_GEN_API_KEY) is preferred; OpenRouter is a free-tier
 * fallback (openrouter/flux-schnell) when only OPENROUTER_API_KEY exists.
 * Still fail-closed: no key → no images.
 */
function resolveImageProvider() {
	const togetherKey = process.env.IMAGE_GEN_API_KEY;
	if (togetherKey) {
		return {
			apiKey: togetherKey,
			apiUrl: process.env.IMAGE_GEN_API_URL || "https://api.together.xyz/v1/images/generations",
			model: process.env.IMAGE_GEN_MODEL || "black-forest-labs/FLUX.1-schnell",
		};
	}
	const openRouterKey = process.env.OPENROUTER_API_KEY;
	if (openRouterKey) {
		return {
			apiKey: openRouterKey,
			apiUrl: "https://openrouter.ai/api/v1/images/generations",
			model: process.env.IMAGE_GEN_MODEL || "openrouter/flux-schnell",
		};
	}
	throw new Error(NO_KEY_REASONS.image);
}

async function generateImage({ prompt, outPath, width = 1024, height = 768 }) {
	const provider = resolveImageProvider();
	const headers = {
		Authorization: `Bearer ${provider.apiKey}`,
		"Content-Type": "application/json",
		...(provider.apiUrl.includes("openrouter.ai") ? { "HTTP-Referer": process.env.RWC_SITE_URL || "https://realworldcerts.com", "X-Title": "realworldcerts course assets" } : {}),
	};
	const payload = {
		prompt,
		model: provider.model,
		width,
		height,
		response_format: "b64_json",
		steps: provider.model.includes("schnell") ? 4 : undefined,
	};
	const res = await fetch(provider.apiUrl, {
		method: "POST", headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(120000),
	});
	if (!res.ok) throw new Error(`Image API ${res.status}: ${await res.text()}`);
	const data = await res.json();
	const b64 = data?.data?.[0]?.b64_json || data?.images?.[0]?.b64_json || data?.data?.[0]?.url;
	if (!b64) throw new Error("Image API returned no b64_json");
	fs.mkdirSync(path.dirname(outPath), { recursive: true });
	// url-form responses must be downloaded; b64 written directly
	if (typeof b64 === "string" && b64.startsWith("http")) {
		const imgRes = await fetch(b64, { signal: AbortSignal.timeout(60000) });
		if (!imgRes.ok) throw new Error(`Image download ${imgRes.status}`);
		fs.writeFileSync(outPath, Buffer.from(await imgRes.arrayBuffer()));
	} else {
		fs.writeFileSync(outPath, Buffer.from(b64, "base64"));
	}
	return outPath;
}

function buildVideos(course) {
	throw new Error(NO_KEY_REASONS.video);
}

function storagePublish(file, assetId) {
	const base = process.env.ASSET_BASE_URL;
	if (!base) {
		// try to use a configured upload endpoint
		const up = process.env.ASSET_UPLOAD_URL;
		if (!up) throw new Error(NO_KEY_REASONS.storage);
		return { url: `${up}/${file}`, local: file, uploaded: false };
	}
	return { url: `${base}/${assetId}`, local: file, uploaded: false };
}

function register(course, assets) {
	let reg = {};
	try { reg = JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8")); } catch { reg = { version: "1.0.0", assets: {}, updated_at: null }; }
	const code = course.code;
	reg.assets[course.slug] = {
		title: course.title,
		course_id: code,
		category: course.category || "",
		status: assets.some((a) => a.broken) ? "PARTIAL" : "GENERATED",
		checked_at: new Date().toISOString(),
		assets: assets.map((a) => ({
			id: a.assetId,
			kind: a.kind,
			url: a.url,
			local: a.local,
			mime: a.mime,
			size: a.size,
			http_verified: a.http_verified,
			broken: a.broken || null,
		})),
		deficits: [],
	};
	fs.mkdirSync(OUT_DIR, { recursive: true });
	fs.writeFileSync(REGISTRY_FILE, JSON.stringify(reg, null, 2));
	return reg;
}

export async function produceCourse(course, args) {
	const slug = course.slug || safeSlug(course.title || "course");
	const code = course.code || courseCode(slug);
	const category = course.category || "General";

	if (args["videos-only"]) {
		return { slug, course_id: code, ok: false, error: NO_KEY_REASONS.video };
	}

	// ---- Asset generation (images) ----
	const assets = [];
	fs.mkdirSync(path.join(ASSETS_LOCAL, slug), { recursive: true });

	const gen = async (kind, idx, prompt, ext = "png", dims) => {
		const assetId = `${code}-${kind}${idx ? "-" + String(idx).padStart(2, "0") : ""}`;
		if (kind === "TRAILER" || kind === "LESSON") {
			assets.push({ assetId, kind, kindLabel: kind, url: null, local: null, generated: false, broken: "video_not_configured" });
			return;
		}
		const rel = `${slug}/${assetId}.${ext}`;
		const local = path.join(ASSETS_LOCAL, rel);
		try {
			await generateImage({ prompt, outPath: local, width: dims?.w, height: dims?.h });
			const stat = fs.statSync(local);
			assets.push({ assetId, kind, kindLabel: kind, url: null, local, mime: MIME_OK["." + ext]?.[0] || "image/png", size: stat.size, generated: true, http_verified: false });
		} catch (e) {
			assets.push({ assetId, kind, kindLabel: kind, url: null, local: null, generated: false, broken: e.message });
		}
		return;
	};

	// required assets
	const p = KIND_PROMPT;
	await gen("HERO", null, p.HERO({ title: course.title, category }), "png", { w: 1536, h: 864 });
	await gen("THUMB", null, p.THUMB({ title: course.title, category }), "png", { w: 1024, h: 1024 });

	const moduleCount = (args["modules"] && parseInt(args["modules"], 10)) || 3;
	for (let i = 1; i <= moduleCount; i++) {
		await gen("MOD", i, p.MOD({ title: course.title, module: `Module ${i}` }), "png", { w: 1024, h: 768 });
	}
	const diagramCount = (args["diagrams"] && parseInt(args["diagrams"], 10)) || 2;
	for (let i = 1; i <= diagramCount; i++) {
		await gen("DIAGRAM", i, p.DIAGRAM({ title: course.title, topic: `Core concept ${i}` }), "png", { w: 1024, h: 768 });
	}
	await gen("CHEAT", null, p.CHEAT({ title: course.title }), "png", { w: 1240, h: 1754 });

	// video (fail-closed)
	let videoErr = null;
	try { buildVideos(course); } catch (e) { videoErr = e.message; }
	await gen("TRAILER", null, "", "mp4");
	const lessonCount = (args["lessons"] && parseInt(args["lessons"], 10)) || 3;
	for (let i = 1; i <= lessonCount; i++) await gen("LESSON", i, "", "mp4");

	// ---- storage publish + register ----
	for (const a of assets) {
		if (!a.local) continue;
		try {
			const pub = storagePublish(a.local, a.assetId);
			a.url = pub.url;
		} catch (e) {
			a.broken = e.message;
		}
	}

	const deficits = [];
	const byKind = {};
	for (const a of assets) { byKind[a.kind] = byKind[a.kind] || []; byKind[a.kind].push(a); }
	// video always deficit unless produced
	if ((byKind["TRAILER"] || []).some((a) => a.broken)) deficits.push("trailer_video");
	const lessonBroken = (byKind["LESSON"] || []).filter((a) => a.broken).length;
	if (lessonBroken) deficits.push(`lesson_videos_${lessonBroken}of${lessonCount}`);
	const heroBroken = (byKind["HERO"] || []).some((a) => a.broken);
	const thumBroken = (byKind["THUMB"] || []).some((a) => a.broken);
	if (heroBroken) deficits.push("hero_image");
	if (thumBroken) deficits.push("thumbnail");
	const modsBroken = (byKind["MOD"] || []).filter((a) => a.broken);
	if (modsBroken.length) deficits.push(`module_images_${modsBroken.length}of${moduleCount}`);

	const ok = deficits.length === 0;
	register(course, assets);
	const manifest = { slug, course_id: code, category, ok, deficits, assets_required: moduleCount, lesson_required: lessonCount, assets_ok: assets.filter((a) => a.generated && !a.broken).length, assets_total: assets.length };
	appendManifest(manifest);
	return manifest;
}

function appendManifest(entry) {
	let list = [];
	try { list = JSON.parse(fs.readFileSync(MANIFEST, "utf8")); } catch { list = []; }
	list.push(entry);
	fs.writeFileSync(MANIFEST, JSON.stringify(list, null, 2));
}

async function main(argv) {
	const args = parseArgs(argv);
	const courses = [];
	if (args.input) {
		const raw = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), args.input), "utf8"));
		const list = Array.isArray(raw) ? raw : raw.items || raw.courses || [];
		for (const it of list) courses.push({
			slug: it.slug || safeSlug(it.title || it.name || "course"),
			title: it.title || it.name || "Course",
			category: it.category || "General",
		});
	} else if (args.slug && args.title) {
		courses.push({ slug: args.slug, title: args.title, category: args.category || "General" });
	} else if (args.slugs) {
		const slugs = args.slugs.split(",").map((s) => s.trim()).filter(Boolean);
		// Load titles from live catalog by slug
		const cat = await (await fetch(process.env.RWC_SITE_URL + "/data/catalog.json", { signal: AbortSignal.timeout(20000) })).json();
		for (const s of slugs) {
			const m = cat.items.find((i) => i.slug === s);
			courses.push({ slug: s, title: m?.title || s, category: m?.category || "General" });
		}
	} else {
		console.error("Usage: --input <courses.json> | --slug <slug> --title <title> [--category <cat>] | --slugs a,b,c");
		process.exit(2);
	}

	if (!courses.length) { console.error("No courses to produce."); process.exit(2); }

	const summary = { ok: 0, blocked: 0, results: [] };
	for (const c of courses) {
		try {
			const r = await produceCourse(c, args);
			summary.results.push(r);
			if (r.ok) summary.ok++;
			else summary.blocked++;
			console.log(JSON.stringify(r, null, 2));
		} catch (e) {
			summary.blocked++;
			summary.results.push({ slug: c.slug, ok: false, error: e.message });
			console.error(`[${c.slug}] ${e.message}`);
		}
	}

	console.log(`\nSUMMARY: ${summary.ok} produced / ${summary.blocked} blocked`);
	if (summary.blocked) { console.error("PUBLISH=BLOCKED (assets not fully verified / video not configured)"); process.exit(1); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main(process.argv).catch((e) => { console.error(e); process.exit(1); });
}
