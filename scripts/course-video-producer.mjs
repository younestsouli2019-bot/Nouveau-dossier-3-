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
import { verifyImageAsset } from "./visual-intelligence.mjs";

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
	image: "No image provider available. Set IMAGE_GEN_API_KEY, or set AIHORDE_ENABLED=1 to use the keyless AI Horde (https://aihorde.net) anonymous worker pool.",
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
 * AI Horde (AIHORDE_ENABLED=1) is an explicit opt-in to the verified
 * keyless anonymous pool and takes precedence. Together
 * (IMAGE_GEN_API_KEY) is next; OpenRouter last (its image endpoint
 * 402s without purchased credits).
 * Still fail-closed: no provider -> no images.
 */
function resolveImageProvider() {
	if (process.env.AIHORDE_ENABLED === "1") {
		return {
			provider: "aihorde",
			apiKey: process.env.AIHORDE_API_KEY || "0000000000",
			apiUrl: "https://aihorde.net/api/v2/generate/async",
			model: process.env.AIHORDE_MODEL || "AlbedoBase XL (SDXL)",
		};
	}
	const togetherKey = process.env.IMAGE_GEN_API_KEY;
	if (togetherKey) {
		return {
			provider: "together",
			apiKey: togetherKey,
			apiUrl: process.env.IMAGE_GEN_API_URL || "https://api.together.xyz/v1/images/generations",
			model: process.env.IMAGE_GEN_MODEL || "black-forest-labs/FLUX.1-schnell",
		};
	}
	const openRouterKey = process.env.OPENROUTER_API_KEY;
	if (openRouterKey) {
		return {
			provider: "openrouter",
			apiKey: openRouterKey,
			apiUrl: "https://openrouter.ai/api/v1/images/generations",
			model: process.env.IMAGE_GEN_MODEL || "google/gemini-2.5-flash-image",
		};
	}
	throw new Error(NO_KEY_REASONS.image);
}

function generateImage({ prompt, outPath, width = 1024, height = 768 }) {
	const provider = resolveImageProvider();
	if (provider.provider === "aihorde") return generateImageHorde(provider, { prompt, outPath, width, height });
	// openai-compatible providers give no stable public URL in all cases;
	// verification (if any) must run after the asset is hosted.
	return generateImageOpenAICompatible(provider, { prompt, outPath, width, height }).then((p) => ({ path: p, publicUrl: null, censored: false }));
}

/**
 * AI Horde (https://aihorde.net) — verified keyless anonymous image
 * generation on the crowd-sourced GPU pool. Anonymous requests are
 * served at low priority; budget generous wall-clock per image.
 * Real bytes are downloaded and written, or the asset is marked
 * broken — nothing is fabricated.
 */
async function generateImageHorde(provider, { prompt, outPath, width, height }) {
	const HDR = {
		apikey: provider.apiKey,
		"Content-Type": "application/json",
		"Client-Agent": process.env.AIHORDE_CLIENT_AGENT || "rwc-course-media:1.0:email",
	};
	// Horde workers cap SDXL at 1024 on the long edge; clamp to stay servable.
	const w = Math.min(Math.round(width / 64) * 64, 1024);
	const h = Math.min(Math.round(height / 64) * 64, 1024);
	// Retry the submit+download against transient Horde outages (they occur).
	const attempts = parseInt(process.env.AIHORDE_RETRIES || "3", 10);
	let lastErr = null;
	for (let attempt = 1; attempt <= attempts; attempt++) {
		if (attempt > 1) await new Promise((r) => setTimeout(r, 20000 * attempt));
		try {
			return await hordeSubmitOnce(HDR, { prompt, w, h, outPath, model: provider.model });
		} catch (e) {
			lastErr = e;
			if (attempt < attempts) console.warn(`[horde] attempt ${attempt} failed: ${e.message}`);
		}
	}
	throw lastErr;
}

async function hordeSubmitOnce(HDR, { prompt, w, h, outPath, model }) {
	const submit = await fetch("https://aihorde.net/api/v2/generate/async", {
		method: "POST",
		headers: HDR,
		body: JSON.stringify({
			prompt,
			params: {
				sampler_name: "k_euler_a",
				cfg_scale: 7,
				width: w,
				height: h,
				steps: 25,
				n: 1,
			},
			nsfw: false,
			censor_nsfw: true,
			models: [model],
			r2: true,
		}),
		signal: AbortSignal.timeout(30000),
	});
	if (!submit.ok) throw new Error(`AI Horde submit ${submit.status}: ${(await submit.text()).slice(0, 160)}`);
	const job = await submit.json();
	if (!job.id) throw new Error(`AI Horde submit rejected: ${JSON.stringify(job).slice(0, 160)}`);

	const deadlineMs = (parseInt(process.env.AIHORDE_TIMEOUT_MS, 10) || 10) * 60 * 1000;
	const started = Date.now();
	let done = false;
	while (!done) {
		if (Date.now() - started > deadlineMs) throw new Error(`AI Horde job ${job.id} timed out after ${Math.round(deadlineMs / 60000)}min`);
		await new Promise((r) => setTimeout(r, 5000));
		const chkRes = await fetch(`https://aihorde.net/api/v2/generate/check/${job.id}`, { headers: HDR, signal: AbortSignal.timeout(20000) });
		if (!chkRes.ok) throw new Error(`AI Horde check ${chkRes.status}`);
		const chk = await chkRes.json();
		if (chk.faulted) throw new Error(`AI Horde job ${job.id} faulted`);
		done = Boolean(chk.done);
	}
	const stRes = await fetch(`https://aihorde.net/api/v2/generate/status/${job.id}`, { headers: HDR, signal: AbortSignal.timeout(20000) });
	if (!stRes.ok) throw new Error(`AI Horde status ${stRes.status}`);
	const st = await stRes.json();
	const gen = await st.generations?.[0];
	if (!gen?.img) throw new Error(`AI Horde returned no image (generations=${st.generations?.length})`);
	const imgRes = await fetch(gen.img, { signal: AbortSignal.timeout(60000) });
	if (!imgRes.ok) throw new Error(`AI Horde image download ${imgRes.status}`);
	const buf = Buffer.from(await imgRes.arrayBuffer());
	if (buf.length < 1024) throw new Error(`AI Horde image suspiciously small (${buf.length} bytes)`);
	fs.mkdirSync(path.dirname(outPath), { recursive: true });
	const out = outPath.endsWith(".png") ? outPath.replace(/\.png$/, ".webp") : outPath;
	fs.writeFileSync(out, buf);
	return { path: out, publicUrl: gen.img, censored: gen.censored || false };
}

// ---- end hordeSubmitOnce ----

async function generateImageOpenAICompatible(provider, { prompt, outPath, width, height }) {
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

/**
 * Synthesize course videos LOCALLY from the real generated images.
 * Fail-closed: requires ffmpeg + real source files, else throws and
 * the asset stays broken. No placeholders, no fabricated URLs.
 *
 * videoMode: "auto" (synthesize when ffmpeg is available and images
 * exist; otherwise throw "video_not_configured"), or "ffmpeg" (require
 * synthesis). Controlled by RWC_VIDEO_MODE env.
 */
async function buildVideos(course, assets, lessonCount, codeOverride) {
	const mode = process.env.RWC_VIDEO_MODE || "auto";
	const synth = await import("./video-synthesis.mjs").catch(() => { throw new Error(NO_KEY_REASONS.video); });
	// resolve ffmpeg up-front so we fail fast with a clear message
	synth.resolveFfmpeg();

	const imgs = assets.filter((a) => a.generated && a.local && !a.broken && ["HERO", "THUMB", "MOD", "DIAGRAM", "CHEAT"].includes(a.kind));
	if (!imgs.length) throw new Error("no generated images available to synthesize videos from");

	const kindOrder = ["HERO", "THUMB", "MOD", "DIAGRAM", "CHEAT"];
	const ordered = imgs.sort((a, b) => kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind));
	const code = codeOverride || course.code || courseCode(course.slug);
	const slug = course.slug;

	const dir = path.join(ASSETS_LOCAL, slug);
	const trailerPath = path.join(dir, `${code}-TRAILER.mp4`);
	const r = await synth.renderSlideshow({ imagePaths: ordered.map((a) => a.local), outPath: trailerPath, perImageMs: 2600, transitionMs: 500 });
	assets.push({ assetId: `${code}-TRAILER`, kind: "TRAILER", kindLabel: "TRAILER", url: null, local: r.path, mime: "video/mp4", size: r.size, generated: true, http_verified: false, visual_intel: null, public_source: null });

	// lessons: rotate through images in slices
	for (let i = 1; i <= lessonCount; i++) {
		const sub = ordered.slice(Math.max(0, (i - 1) * Math.ceil(ordered.length / lessonCount)), Math.min(ordered.length, i * Math.ceil(ordered.length / lessonCount)));
		const lessonPath = path.join(dir, `${code}-LESSON-${String(i).padStart(2, "0")}.mp4`);
		try {
			const lr = await synth.renderSlideshow({ imagePaths: sub.map((a) => a.local), outPath: lessonPath, perImageMs: 3000, transitionMs: 600 });
			assets.push({ assetId: `${code}-LESSON-${String(i).padStart(2, "0")}`, kind: "LESSON", kindLabel: "LESSON", url: null, local: lr.path, mime: "video/mp4", size: lr.size, generated: true, http_verified: false, visual_intel: null, public_source: null });
		} catch (e) {
			assets.push({ assetId: `${code}-LESSON-${String(i).padStart(2, "0")}`, kind: "LESSON", kindLabel: "LESSON", url: null, local: null, generated: false, broken: e.message });
		}
	}
}

function mimeFor(file) {
	const ext = path.extname(file).toLowerCase();
	const ok = MIME_OK[ext];
	return (ok && ok.length ? ok[0] : "") || (file.endsWith(".mp4") ? "video/mp4" : "application/octet-stream");
}

async function httpVerify(url) {
	if (process.env.ASSET_VERIFY === "0") return false;
	try {
		const res = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(8000) });
		return res.ok || res.status === 405;
	} catch {
		// unreachable from THIS network != asset not hosted; the CI media audit
		// re-verifies from GitHub's network. Fail open.
		return false;
	}
}

/**
 * Publish a real local asset to a public host. Two supported modes, else fail-closed:
 *   Mode A (static): ASSET_BASE_URL + ASSET_STATIC_DIR (default "rank/output/media").
 *     Copies the actual bytes into the deploy tree that the `release` branch push
 *     ships to Vercel (realworldcerts), so the public URL resolves from the live
 *     origin host.
 *   Mode B (upload): ASSET_UPLOAD_URL (+ optional ASSET_UPLOAD_TOKEN bearer).
 *     PUTs the real bytes to an HTTP(S) endpoint and takes the public URL from the
 *     server (Location header, or {url|path} JSON) — never fabricates one.
 * Never returns a URL unless the file was actually staged/uploaded.
 */
export async function storagePublish(file, assetId, code) {
	const base = process.env.ASSET_BASE_URL;
	if (base) {
		const staticDir = process.env.ASSET_STATIC_DIR || path.join("rank", "output");
		const rel = path.posix.join("media", code || assetId, path.basename(file).split(path.sep).pop());
		const dest = path.isAbsolute(staticDir) ? path.join(staticDir, ...rel.split("/")) : path.join(ROOT, staticDir, ...rel.split("/"));
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.copyFileSync(file, dest);
		const url = `${base.replace(/\/+$/, "")}/${rel}`;
		return { url, local: dest, uploaded: true, http_verified: await httpVerify(url) };
	}
	const up = process.env.ASSET_UPLOAD_URL;
	if (up) {
		const token = process.env.ASSET_UPLOAD_TOKEN;
		const buf = fs.readFileSync(file);
		const res = await fetch(up, {
			method: "PUT",
			headers: {
				"Content-Type": mimeFor(file),
				...(token ? { Authorization: `Bearer ${token}` } : {}),
				"x-asset-id": `${code || "asset"}-${assetId}`,
			},
			body: buf,
			signal: AbortSignal.timeout(60000),
		});
		if (!res.ok) throw new Error(`ASSET_UPLOAD_URL PUT ${res.status}: ${(await res.text()).slice(0, 140)}`);
		const loc = res.headers.get("location");
		if (loc) return { url: new URL(loc, up).toString(), local: file, uploaded: true };
		const jt = await res.json().catch(() => null);
		if (jt?.url || jt?.path) return { url: new URL(jt.url || jt.path, up).toString(), local: file, uploaded: true };
		throw new Error("ASSET_UPLOAD_URL returned 2xx but no public URL (need Location header or {url|path} body)");
	}
	throw new Error(NO_KEY_REASONS.storage);
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
			publish_error: a.publish_error || null,
			visual_intel: a.visual_intel || null,
			public_source: a.public_source || null,
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
			const written = await generateImage({ prompt, outPath: local, width: dims?.w, height: dims?.h });
			const stat = fs.statSync(written.path);
			const realExt = path.extname(written.path) || "." + ext;
			// Visual intelligence: interrogate the fresh public R2 URL to confirm
			// the image depicts what the prompt asked for. Advisory, fail-open.
			let visual = { status: "skipped", reason: "no public URL available for interrogation" };
			if (written.publicUrl) {
				// Compare the caption against core subject keywords (title + category),
				// not the full verbose prompt: CLIP captions are short and concrete.
				visual = await verifyImageAsset({ sourceUrl: written.publicUrl, expectedSubject: `${course.title} ${category} ${kind}` });
			}
			assets.push({
				assetId, kind, kindLabel: kind, url: null, local: written.path,
				mime: MIME_OK[realExt]?.[0] || "image/png", size: stat.size, generated: true, http_verified: false,
				visual_intel: visual,
				public_source: written.publicUrl || null,
			});
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
	const lessonCount = (args["lessons"] && parseInt(args["lessons"], 10)) || 3;
	for (let i = 1; i <= moduleCount; i++) {
		await gen("MOD", i, p.MOD({ title: course.title, module: `Module ${i}` }), "png", { w: 1024, h: 768 });
	}
	const diagramCount = (args["diagrams"] && parseInt(args["diagrams"], 10)) || 2;
	for (let i = 1; i <= diagramCount; i++) {
		await gen("DIAGRAM", i, p.DIAGRAM({ title: course.title, topic: `Core concept ${i}` }), "png", { w: 1024, h: 768 });
	}
	await gen("CHEAT", null, p.CHEAT({ title: course.title }), "png", { w: 1240, h: 1754 });

	// video (fail-closed local synthesis from REAL images; never fabricated)
	let videoErr = null;
	if (process.env.RWC_VIDEO_MODE !== "off") {
		try { await buildVideos(course, assets, lessonCount, code); } catch (e) { videoErr = e.message; }
	} else {
		videoErr = NO_KEY_REASONS.video;
	}

	// ---- storage publish + register ----
	for (const a of assets) {
		if (!a.local) continue;
		try {
			const pub = await storagePublish(a.local, a.assetId, code);
			a.url = pub.url;
			if (pub.http_verified) a.http_verified = true;
		} catch (e) {
			// host/publish failure is a distinct concern from synthesis
			// failure: keep `broken` for synthesis, record publish separately.
			a.publish_error = e.message;
		}
	}

	const deficits = [];
	const byKind = {};
	for (const a of assets) { byKind[a.kind] = byKind[a.kind] || []; byKind[a.kind].push(a); }
	// video deficit: synthesis attempt failed/off only
	const trailerGen = (byKind["TRAILER"] || []).find((a) => a.generated);
	const trailerBroken = (byKind["TRAILER"] || []).some((a) => a.broken);
	if (videoErr && !trailerGen) deficits.push("trailer_video");
	else if (trailerBroken) deficits.push("trailer_video");
	const lessonBroken = (byKind["LESSON"] || []).filter((a) => a.broken).length;
	if (videoErr && !(byKind["LESSON"] || []).some((a) => a.generated)) deficits.push(`lesson_videos_${lessonCount}of${lessonCount}`);
	if (lessonBroken) deficits.push(`lesson_videos_${lessonBroken}of${lessonCount}`);
	const heroBroken = (byKind["HERO"] || []).some((a) => a.broken);
	const thumBroken = (byKind["THUMB"] || []).some((a) => a.broken);
	if (heroBroken) deficits.push("hero_image");
	if (thumBroken) deficits.push("thumbnail");
	const modsBroken = (byKind["MOD"] || []).filter((a) => a.broken);
	if (modsBroken.length) deficits.push(`module_images_${modsBroken.length}of${moduleCount}`);
	// public host missing: assets are real but not HTTP-verifiable yet
	const publishBlocked = assets.filter((a) => a.publish_error).length;
	if (publishBlocked) deficits.push(`storage_host_${publishBlocked}of${assets.length}`);

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
