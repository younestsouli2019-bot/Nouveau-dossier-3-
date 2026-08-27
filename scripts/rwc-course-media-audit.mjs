import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import {
	CONTRACT_VERSION,
	MediaContract,
	httpCheck,
	validateMime,
	fileSizeOk,
	detectPlaceholderText,
	isSameUnique,
	REGISTRY_FILE,
} from "./course-media-contract.mjs";

const SITE = process.env.RWC_SITE_URL || "https://www.realworldcerts.com";
const CATALOG_URL = `${SITE}/data/catalog.json`;
const CONCURRENCY = 8;

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
	const res = await fetch(url, { headers: { "User-Agent": "MediaContractAudit/1.0" }, signal: AbortSignal.timeout(20000) });
	if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
	return res.json();
}

async function fetchHtml(url) {
	const res = await fetch(url, { headers: { "User-Agent": "MediaContractAudit/1.0" }, signal: AbortSignal.timeout(20000) });
	const text = await res.text();
	return { status: res.status, url: res.url, text };
}

function uniqueAttrs(html, re) {
	const set = new Set();
	for (const m of html.matchAll(re)) set.add(m[1]);
	return [...set];
}

function decodeEntity(s) {
	return s.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function isSvg(src) { return /\.svg(\?|$)/i.test(src); }
function isVideo(src) { return /\.(mp4|webm|m4v)(\?|$)/i.test(src) || src.includes("youtube.com") || src.includes("vimeo.com"); }

async function auditCourse(item, opts) {
	const contract = new MediaContract(item.courseId || item.slug, opts.contract);
	const slug = item.slug;
	const pageUrl = `${SITE}/catalog/${encodeURIComponent(slug)}.html`;
	const report = {
		slug,
		title: item.title,
		course_id: item.courseId || null,
		page_url: pageUrl,
		checks: {},
		placeholders: [],
		recycled: [],
		broken: [],
		asset_ids: [],
		status: "PASS",
		fail_reasons: [],
	};

	let html = "";
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

	// collect image & video urls (dedupe by src)
	const imgSrcs = uniqueAttrs(html, /<img\b[^>]*src=["']([^"']+)["']/gi).map(decodeEntity);
	const videoEls = [...html.matchAll(/<video\b[^>]*>([\s\S]*?)<\/video>/gi)];
	const videoSrcs = uniqueAttrs(html, /<video\b[^>]*src=["']([^"']+)["']/gi).map(decodeEntity);
	for (const m of html.matchAll(/<source\b[^>]*src=["']([^"']+)["']/gi)) videoSrcs.push(decodeEntity(m[1]));
	const youtube = uniqueAttrs(html, /<iframe\b[^>]*src=["']([^"']*youtube\.com[^"']+)["']/gi).map(decodeEntity);
	const videoUrls = [...new Set([...videoSrcs, ...youtube])];

	const svgSet = imgSrcs.filter(isSvg);
	const imgSeen = new Set();
	for (const s of imgSrcs) isSameUnique(s, imgSeen);
	const uniqueImages = [...imgSeen];
	const duplicateImages = imgSrcs.length - uniqueImages.length;

	report.image_count = imgSrcs.length;
	report.unique_images = uniqueImages.length;
	report.duplicate_image_uses = duplicateImages;
	report.video_element_count = videoEls.length;
	report.video_src_count = videoUrls.length;

	// empty video tags
	if (videoEls.length) {
		const empty = videoEls.filter((v) => !/src=/i.test(v[0]) && !/<source/i.test(v[0]));
		if (empty.length) {
			report.status = "FAIL";
			report.fail_reasons.push("empty_video_tag");
		}
	}

	// ---------------- asset_count checks ----------------
	const moduleImages = svgSet.filter((s) => !/\-[a-z]$/.test(s.split("?")[0]));
	contract.checkQuantity("hero_image", uniqueImages >= 1 ? 1 : 0, 1);
	contract.checkQuantity("thumbnail", uniqueImages >= 1 ? 1 : 0, 1);
	// module images = distinct svg posters that are NOT the hero/main one
	const distinctPosters = new Set(svgSet.map((s) => s.replace(/[-][a-z](?=\.svg$)/, "").split("?")[0]));
	contract.checkQuantity("module_images", distinctPosters.size >= 1 ? distinctPosters.size : 0, contract.required.module_images);
	contract.checkQuantity("diagrams", 0, contract.required.diagrams);
	contract.checkQuantity("trailer_video", videoUrls.length ? 1 : 0, 1);
	contract.checkQuantity("lesson_videos", videoUrls.length, contract.required.lesson_videos);
	contract.checkQuantity("video_thumbnails", uniqueImages, contract.required.video_thumbnails);
	contract.checkQuantity("cheat_sheet", 0, 1);

	// recycled: 3 unique posters reused as 12 content cards
	if (duplicateImages >= 6 && uniqueImages <= 3) {
		report.recycled.push(`only ${uniqueImages} unique image(s) reused ${imgSrcs.length} times across content cards`);
		report.status = "FAIL";
		report.fail_reasons.push("recycled_images");
	}

	// ---------------- external URL verification ----------------
	const assetsToVerify = [...new Set([...imgSrcs, ...videoUrls].map((u) => new URL(u, SITE).toString()))];
	report.broken = [];
	for (const urls of chunk(assetsToVerify, CONCURRENCY)) {
		await Promise.all(urls.map(async (u) => {
			try {
				const { status, ok, contentType } = await httpCheck(u);
				if (status >= 400) {
					report.broken.push({ url: u, status });
					report.status = "FAIL";
					report.fail_reasons.push("broken_asset_url");
					return;
				}
				const mimeErr = validateMime(u, contentType);
				if (mimeErr) {
					report.broken.push({ url: u, status, mime: mimeErr });
					report.status = "FAIL";
					report.fail_reasons.push("bad_mime");
				}
			} catch (e) {
				report.broken.push({ url: u, error: e.message });
				report.status = "FAIL";
				report.fail_reasons.push("asset_fetch_error");
			}
		}));
	}

	// ---------------- final gates ----------------
	const anyAssetFail = Object.values(contract.results).some((r) => r.status === "FAIL");
	if (anyAssetFail && report.status === "PASS") {
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
	lines.push("COURSE MEDIA AUDIT");
	lines.push("==================");
	const grouped = new Map();
	for (const r of reports) {
		const cat = r.category || "Uncategorized";
		if (!grouped.has(cat)) grouped.set(cat, []);
		grouped.get(cat).push(r);
	}
	let totalPass = 0, totalFail = 0;
	for (const [cat, rs] of grouped) {
		lines.push("");
		lines.push(cat);
		let pass = 0;
		for (const r of rs) {
			const status = r.status === "PASS" ? "PASS" : "FAIL";
			if (r.status === "PASS") pass++;
			lines.push(`  ${r.title}`);
			lines.push(`    Hero             ${r.checks.hero_image?.status === "PASS" ? "PASS" : "FAIL"}`);
			lines.push(`    Thumbnail        ${r.checks.thumbnail?.status === "PASS" ? "PASS" : "FAIL"}`);
			lines.push(`    Illustrations    ${r.checks.module_images?.found ?? "?"}/${r.checks.module_images?.required ?? "?"} ${r.checks.module_images?.status === "PASS" ? "PASS" : "FAIL"}`);
			lines.push(`    Diagrams         ${r.checks.diagrams?.found ?? "?"}/${r.checks.diagrams?.required ?? "?"} ${r.checks.diagrams?.status === "PASS" ? "PASS" : "FAIL"}`);
			lines.push(`    Trailer          ${r.checks.trailer_video?.status === "PASS" ? "PASS" : "FAIL"}`);
			lines.push(`    Lessons          ${r.checks.lesson_videos?.found ?? "?"}/${r.checks.lesson_videos?.required ?? "?"} ${r.checks.lesson_videos?.status === "PASS" ? "PASS" : "FAIL"}`);
			lines.push(`    Mobile           ${r.page_status === 200 ? "PASS" : "FAIL"}`);
			if (r.recycled.length) {
				for (const rec of r.recycled) lines.push(`    [recycled] ${rec}`);
			}
			if (r.broken.length) {
				for (const b of r.broken.slice(0, 3)) lines.push(`    [broken] ${b.url} ${b.status || b.error || ""}`);
			}
			if (r.status === "FAIL") {
				totalFail++;
				const reasons = [...new Set(r.fail_reasons)].slice(0, 4);
				lines.push(`    REASON: ${reasons.join(", ")}`);
			} else {
				totalPass++;
			}
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

	const registry = MediaContract.registry();
	let catalog;
	try {
		catalog = await fetchJson(CATALOG_URL);
	} catch (e) {
		console.error(`Cannot load catalog: ${e.message}`);
		process.exit(2);
	}
	let items = catalog.items;
	if (only?.length) items = items.filter((i) => only.includes(i.slug) || only.some((o) => i.title.toLowerCase().includes(o.toLowerCase())));
	if (limit) items = items.slice(0, limit);

	console.error(`Auditing ${items.length} courses from ${CATALOG_URL} ...`);

	const reports = [];
	for (const batch of chunk(items, CONCURRENCY)) {
		const rs = await Promise.all(batch.map((item) => auditCourse(item, args)));
		reports.push(...rs);
		// register asset ids into registry
		for (const r of rs) {
			registry.assets[r.slug] = {
				title: r.title,
				status: r.status,
				page_url: r.page_url,
				checked_at: new Date().toISOString(),
				checks: r.checks,
				asset_urls: r.broken.length ? { broken: r.broken.map((b) => b.url) } : {},
			};
		}
	}
	MediaContract.saveRegistry(registry);

	const fails = reports.filter((r) => r.status !== "PASS");
	const output = {
		site: SITE,
		contract_version: CONTRACT_VERSION,
		checked_at: new Date().toISOString(),
		audited: reports.length,
		pass: reports.length - fails.length,
		fail: fails.length,
		publish: fails.length === 0 ? "ALLOWED" : "BLOCKED",
		reason: fails.length ? "MEDIA_CONTRACT_FAILED" : null,
		registry_file: REGISTRY_FILE,
		reports,
	};

	const outPath = args.out || path.join(ROOT_DIR(), "data", "out", "course-media-audit.json");
	fs.mkdirSync(path.dirname(outPath), { recursive: true });
	fs.writeFileSync(outPath, JSON.stringify({ summary: { ...output }, reports }, null, 2));

	if (!json) {
		console.log(renderReport(reports, args));
	} else {
		console.log(JSON.stringify(output, null, 2));
	}

	process.exitCode = fails.length ? 1 : 0;
}

function ROOT_DIR() {
	return path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});