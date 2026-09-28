import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	CONTRACT_VERSION,
	MediaContract,
	httpCheck,
	validateMime,
	detectPlaceholderText,
	isSameUnique,
	REGISTRY_FILE,
} from "./course-media-contract.mjs";

const SITE = process.env.RWC_SITE_URL || "https://www.realworldcerts.com";
const CONCURRENCY = 8;
const IMAGE_EXTS = new Set([".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"]);
const VIDEO_EXTS = new Set([".mp4", ".webm", ".m4v"]);
const HOLD_HOST = "rwc-hold.invalid";

// checks that are hard health/misinformation failures on ANY tier
const CORE_HARD_KINDS = new Set(["hero_image", "thumbnail"]);
// rich-media enhancement checks (required only for courses with committed media)
const ENHANCED_KINDS = [
	"module_images",
	"diagrams",
	"trailer_video",
	"lesson_videos",
	"video_thumbnails",
	"cheat_sheet",
];

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

async function fetchJson(url) {
	const res = await fetch(url, { headers: { "User-Agent": "MediaContractAudit/2.0" }, signal: AbortSignal.timeout(20000) });
	if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
	return res.json();
}

async function fetchHtml(url) {
	const res = await fetch(url, { headers: { "User-Agent": "MediaContractAudit/2.0" }, signal: AbortSignal.timeout(20000) });
	const text = await res.text();
	return { status: res.status, url: res.url, text };
}

function readArtifactCatalog(root) {
	const p = path.join(root, "data", "catalog.json");
	const raw = fs.readFileSync(p, "utf8");
	return JSON.parse(raw);
}

function readArtifactPage(root, slug) {
	const p = path.join(root, "catalog", slug + ".html");
	if (!fs.existsSync(p)) return { status: 404, text: "" };
	return { status: 200, text: fs.readFileSync(p, "utf8") };
}

function uniqueAttrs(html, re) {
	const set = new Set();
	for (const m of html.matchAll(re)) set.add(m[1]);
	return [...set];
}

function decodeEntity(s) {
	return s.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function isImageSrc(src) {
	const ext = path.extname(new URL(src, `https://${HOLD_HOST}`).pathname).toLowerCase();
	return IMAGE_EXTS.has(ext);
}
function isVideoExt(ext) {
	return VIDEO_EXTS.has(String(ext).toLowerCase());
}

function safeResolve(root, pathname) {
	const p = path.resolve(root, "." + pathname);
	const rootResolved = path.resolve(root);
	if (p !== rootResolved && !p.startsWith(rootResolved + path.sep)) return null;
	return p;
}

async function verifyAssets(assets, rootDir, report) {
	const unique = [...new Set(assets.map((u) => u.toString()))];
	for (const urls of chunk(unique, CONCURRENCY)) {
		await Promise.all(urls.map(async (u) => {
			let proto;
			try {
				proto = new URL(u, `https://${HOLD_HOST}`).protocol;
			} catch {
				proto = "data:";
			}
			if (proto === "data:") return;
			let url;
			try {
				url = new URL(u, `https://${HOLD_HOST}`);
			} catch (e) {
				report.broken.push({ url: u, error: "unparsable_asset_url" });
				report.status = "FAIL";
				report.fail_reasons.push("broken_asset_url");
				return;
			}
			const external = url.protocol.startsWith("http") && url.hostname !== HOLD_HOST;
			if (external) {
				try {
					const { status, ok, contentType } = await httpCheck(url.toString());
					if (status >= 400) {
						report.broken.push({ url: url.toString(), status });
						report.status = "FAIL";
						report.fail_reasons.push("broken_asset_url");
						return;
					}
					const mimeErr = validateMime(url.toString(), contentType);
					if (mimeErr) {
						report.broken.push({ url: url.toString(), status, mime: mimeErr });
						report.status = "FAIL";
						report.fail_reasons.push("bad_mime");
					}
					return;
				} catch (e) {
					report.broken.push({ url: url.toString(), error: e.message });
					report.status = "FAIL";
					report.fail_reasons.push("asset_fetch_error");
					return;
				}
			}
			// root-relative artifact asset
			if (!rootDir) {
				report.broken.push({ url: u.toString(), error: "artifact_asset_without_root" });
				report.status = "FAIL";
				report.fail_reasons.push("broken_asset_url");
				return;
			}
			const pathname = decodeURIComponent(url.pathname);
			const p = safeResolve(rootDir, pathname);
			if (!p || !fs.existsSync(p)) {
				report.broken.push({ url: u.toString(), path: pathname, error: "asset_missing_in_artifact" });
				report.status = "FAIL";
				report.fail_reasons.push("broken_asset_url");
				return;
			}
			const st = fs.statSync(p);
			if (!st.size || st.size <= 0) {
				report.broken.push({ url: u.toString(), path: pathname, error: "asset_empty_in_artifact" });
				report.status = "FAIL";
				report.fail_reasons.push("broken_asset_url");
			}
		}));
	}
}

async function auditCourse(item, opts) {
	const contract = new MediaContract(item.courseId || item.slug, opts.contract);
	const slug = item.slug;
	const tier = opts.requiredSlugs && opts.requiredSlugs.has(slug) ? "required" : "standard";
	const pageUrl = `${SITE}/catalog/${encodeURIComponent(slug)}.html`;
	const report = {
		slug,
		title: item.title,
		course_id: item.courseId || null,
		tier,
		page_url: pageUrl,
		checks: {},
		placeholders: [],
		recycled: [],
		broken: [],
		warnings: [],
		asset_ids: [],
		status: "PASS",
		fail_reasons: [],
	};

	let html = "";
	if (opts.root) {
		const page = readArtifactPage(opts.root, slug);
		report.page_status = page.status;
		if (page.status !== 200) {
			report.status = "FAIL";
			report.fail_reasons.push("page_not_in_artifact");
		}
		html = page.text;
	} else {
		try {
			const page = await fetchHtml(pageUrl);
			report.page_status = page.status;
			if (page.status !== 200) {
				report.status = "FAIL";
				report.fail_reasons.push("page_not_200");
			}
			html = page.text;
		} catch (e) {
			report.status = "FAIL";
			report.fail_reasons.push("page_fetch_error");
			report.error = e.message;
			return report;
		}
	}

	if (report.page_status === 200 && html.length < 3000) {
		report.status = "FAIL";
		report.fail_reasons.push("page_too_thin");
	}

	const placeholders = detectPlaceholderText(html);
	if (placeholders.length) {
		report.placeholders = placeholders.slice(0, 10);
		report.status = "FAIL";
		report.fail_reasons.push("placeholder_detected");
	}

	const imgSrcs = uniqueAttrs(html, /<img\b[^>]*src=["']([^"']+)["']/gi).map(decodeEntity);
	const videoEls = [...html.matchAll(/<video\b[^>]*>([\s\S]*?)<\/video>/gi)];
	const videoSrcs = uniqueAttrs(html, /<video\b[^>]*src=["']([^"']+)["']/gi).map(decodeEntity);
	for (const m of html.matchAll(/<source\b[^>]*src=["']([^"']+)["']/gi)) videoSrcs.push(decodeEntity(m[1]));
	const youtube = uniqueAttrs(html, /<iframe\b[^>]*src=["']([^"']*youtube\.com[^"']+)["']/gi).map(decodeEntity);
	const videoUrls = [...new Set([...videoSrcs, ...youtube])];

	const uniqueImages = new Set();
	for (const s of imgSrcs) isSameUnique(s, uniqueImages);
	const duplicateImages = imgSrcs.length - uniqueImages.size;

	report.image_count = imgSrcs.length;
	report.unique_images = uniqueImages.size;
	report.duplicate_image_uses = duplicateImages;
	report.video_element_count = videoEls.length;
	report.video_src_count = videoUrls.length;

	if (videoEls.length) {
		const empty = videoEls.filter((v) => !/src=/i.test(v[0]) && !/<source/i.test(v[0]));
		if (empty.length) {
			report.status = "FAIL";
			report.fail_reasons.push("empty_video_tag");
		}
	}

	// ---- quantity checks ----
	contract.checkQuantity("hero_image", uniqueImages.size >= 1 ? 1 : 0, contract.required.hero_image);
	contract.checkQuantity("thumbnail", uniqueImages.size >= 1 ? 1 : 0, contract.required.thumbnail);
	// module images = distinct on-disk image files (svg/webp/png/jpg/...) referenced by the page
	const fileImages = new Set();
	for (const s of imgSrcs) {
		if (s.startsWith("data:")) continue;
		let url;
		try {
			url = new URL(s, `https://${HOLD_HOST}`);
		} catch {
			continue;
		}
		if (url.hostname !== HOLD_HOST && url.protocol.startsWith("http")) {
			if (isImageSrc(s)) fileImages.add(url.pathname.split("?")[0].toLowerCase());
			continue;
		}
		const ext = path.extname(url.pathname).toLowerCase();
		if (IMAGE_EXTS.has(ext)) fileImages.add(url.pathname.split("?")[0].toLowerCase());
	}
	const distinctPosters = fileImages.size;
	contract.checkQuantity("module_images", distinctPosters, contract.required.module_images);
	if (distinctPosters > 0) {
		const mi = contract.results.module_images;
		if (mi && Array.isArray(mi.assetIds)) {
			for (const f of fileImages) mi.assetIds.push(f);
		}
	}
	contract.checkQuantity("diagrams", 0, contract.required.diagrams);
	contract.checkQuantity("trailer_video", videoUrls.length ? 1 : 0, contract.required.trailer_video);
	contract.checkQuantity("lesson_videos", videoUrls.length, contract.required.lesson_videos);
	contract.checkQuantity("video_thumbnails", uniqueImages.size, contract.required.video_thumbnails);
	contract.checkQuantity("cheat_sheet", 0, contract.required.cheat_sheet);

	// recycled: 3 unique posters reused as 12 content cards
	if (duplicateImages >= 6 && uniqueImages.size <= 3) {
		report.recycled.push(`only ${uniqueImages.size} unique image(s) reused ${imgSrcs.length} times across content cards`);
		report.status = "FAIL";
		report.fail_reasons.push("recycled_images");
	}

	// ---- asset verification (local artifact or external HTTP) ----
	const assetsToVerify = [...new Set([...imgSrcs, ...videoUrls])];
	await verifyAssets(assetsToVerify, opts.root || null, report);

	// ---- tiered gate: enhanced shortfalls soft-fail on standard tiers ----
	const hardKinds = new Set(CORE_HARD_KINDS);
	if (tier === "required") {
		for (const k of ENHANCED_KINDS) hardKinds.add(k);
	}
	let quantityFail = false;
	for (const [kind, r] of Object.entries(contract.results)) {
		if (r.status !== "FAIL") continue;
		if (hardKinds.has(kind)) {
			quantityFail = true;
		} else {
			report.warnings.push(`${kind} below contract gap (found=${r.found}, required=${r.required})`);
		}
	}
	if (quantityFail && report.status === "PASS") {
		report.status = "FAIL";
		report.fail_reasons.push("asset_quantity_below_contract");
	}
	report.checks = contract.results;
	report.asset_ids = Object.fromEntries(
		Object.entries(contract.results).map(([k, v]) => [k, v.assetIds]),
	);
	return report;
}

function chunk(arr, n) {
	const out = [];
	for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
	return out;
}

function renderReport(reports, opts) {
	const lines = [];
	lines.push("COURSE MEDIA AUDIT (root=" + (opts.root || "live:" + SITE) + ")");
	lines.push("==================");
	let totalPass = 0, totalFail = 0;
	for (const r of reports) {
		const pass = r.status === "PASS";
		if (pass) totalPass++;
		else totalFail++;
		const tier = r.tier === "required" ? "[required] " : "";
		lines.push(`  ${tier}${r.title}`);
		lines.push(`    Tier=${r.tier} Hero=${r.checks.hero_image?.status || "?"} Thumb=${r.checks.thumbnail?.status || "?"} Modules=${r.checks.module_images?.found || 0}/${r.checks.module_images?.required || 0} Trailer=${r.checks.trailer_video?.status || "?"} Lessons=${r.checks.lesson_videos?.found || 0}/${r.checks.lesson_videos?.required || 0}`);
		if (r.warnings.length) {
			for (const w of r.warnings.slice(0, 4)) lines.push(`    [warn] ${w}`);
		}
		if (r.recycled.length) {
			for (const rec of r.recycled) lines.push(`    [recycled] ${rec}`);
		}
		if (r.broken.length) {
			for (const b of r.broken.slice(0, 3)) lines.push(`    [broken] ${b.url} ${b.status || b.error || ""}`);
		}
		if (!pass) {
			const reasons = [...new Set(r.fail_reasons)].slice(0, 5);
			lines.push(`    REASON: ${reasons.join(", ")}`);
		}
	}
	lines.push("");
	lines.push(`SUMMARY: ${totalPass} PASS / ${totalFail} FAIL (contract v${CONTRACT_VERSION})`);
	return lines.join("\n");
}

async function main() {
	const args = parseArgs(process.argv);
	const limit = args.limit ? parseInt(args.limit, 10) : null;
	const only = args["only"] ? args["only"].split(",").map((s) => s.trim()) : null;
	const json = Boolean(args.json);
	const root = args.root ? path.resolve(args.root) : null;

	const registry = MediaContract.registry();
	let catalog;
	if (root) {
		try {
			catalog = readArtifactCatalog(root);
		} catch (e) {
			console.error(`Cannot read artifact catalog under ${root}: ${e.message}`);
			process.exit(2);
		}
	} else {
		try {
			catalog = await fetchJson(`${SITE}/data/catalog.json`);
		} catch (e) {
			console.error(`Cannot load catalog: ${e.message}`);
			process.exit(2);
		}
	}
	let items = catalog.items;
	if (only?.length) items = items.filter((i) => only.includes(i.slug) || only.some((o) => i.title.toLowerCase().includes(o.toLowerCase())));
	if (limit) items = items.slice(0, limit);

	// required slugs = courses with committed media in the artifact (dirs under rank/output/media)
	let requiredSlugs = null;
	if (args["required-slugs"]) {
		requiredSlugs = new Set(args["required-slugs"].split(",").map((s) => s.trim()).filter(Boolean));
	} else if (root) {
		const mediaDir = path.join(root, "media");
		if (fs.existsSync(mediaDir)) {
			requiredSlugs = new Set(
				fs.readdirSync(mediaDir).filter((s) => {
					try { return fs.statSync(path.join(mediaDir, s)).isDirectory(); } catch { return false; }
				}),
			);
		}
	}
	const opts = { ...args, root, requiredSlugs };
	console.error(`Auditing ${items.length} courses (root=${root || "live site"}, required-slugs=${requiredSlugs ? requiredSlugs.size : "none"}) ...`);

	const reports = [];
	for (const batch of chunk(items, CONCURRENCY)) {
		const rs = await Promise.all(batch.map((item) => auditCourse(item, opts)));
		reports.push(...rs);
		for (const r of rs) {
			registry.assets[r.slug] = {
				title: r.title,
				status: r.status,
				tier: r.tier,
				page_url: r.page_url,
				checked_at: new Date().toISOString(),
				checks: r.checks,
				asset_urls: r.broken.length ? { broken: r.broken.map((b) => b.url) } : {},
			};
		}
	}
	MediaContract.saveRegistry(registry);

	const fails = reports.filter((r) => r.status !== "PASS");
	const requiredFail = reports.filter((r) => r.tier === "required" && r.status !== "PASS");
	const output = {
		site: root ? `artifact:${root}` : SITE,
		root: root || null,
		contract_version: CONTRACT_VERSION,
		checked_at: new Date().toISOString(),
		audited: reports.length,
		pass: reports.length - fails.length,
		fail: fails.length,
		required_audited: reports.filter((r) => r.tier === "required").length,
		required_pass: reports.filter((r) => r.tier === "required" && r.status === "PASS").length,
		publish: fails.length === 0 ? "ALLOWED" : "BLOCKED",
		reason: fails.length ? "MEDIA_CONTRACT_FAILED" : null,
		registry_file: REGISTRY_FILE,
		reports,
	};

	const outPath = args.out || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "out", "course-media-audit.json");
	fs.mkdirSync(path.dirname(outPath), { recursive: true });
	fs.writeFileSync(outPath, JSON.stringify({ summary: { ...output }, reports }, null, 2));

	if (!json) {
		console.log(renderReport(reports, opts));
		console.log(JSON.stringify({ publish: output.publish, reason: output.reason, required_pass: output.required_pass, required_audited: output.required_audited }, null, 2));
	} else {
		console.log(JSON.stringify(output, null, 2));
	}

	process.exitCode = fails.length ? 1 : 0;
	if (requiredFail.length) {
		console.error(`BLOCKED REASON=MEDIA_CONTRACT_FAILED required-tier fail: ${requiredFail.map((r) => r.slug).join(",")}`);
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});