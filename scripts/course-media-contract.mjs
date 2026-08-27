import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY_DIR = path.join(ROOT, "data", "out");
export const REGISTRY_FILE = path.join(REGISTRY_DIR, "course-asset-registry.json");

export const CONTRACT_VERSION = "1.0.0";

export const PLACEHOLDER_PATTERNS = [
	{ id: "placeholder_file", label: "placeholder-named file", re: /(^|\/)(placeholder|sample|temp|dummy)([-_.]|\d|$)/i },
	{ id: "placeholder_alt", label: "placeholder text in alt", re: /placeholder|coming soon|coming-soon|to be added|tbd/i },
	{ id: "empty_tag", label: "empty media tag", re: /<video[\s>][^>]*>\s*<\/video>|<img[\s>][^>]*>\s*<\/img>|<source[^>]*src=["']\s*["']/i },
	{ id: "youtube_unrelated", label: "bare YouTube embed", re: /youtube\.com\/(embed|watch)[^"']*/i },
	{ id: "fake_filename", label: "generated-looking filename", re: /(^|\/)(image|img|photo|file|pic)[-_]?\d{2,}\.(jpg|jpeg|png|webp)(\?|$)/i },
	{ id: "recycled_image", label: "same asset reused as unique content" },
	{ id: "css_gradient_art", label: "CSS gradient pretending to be art", re: /linear-gradient\([^)]*\)[^>]*>\s*<\/div>/i },
];

export const MIME_OK = {
	".svg": ["image/svg+xml", "image/svg", "text/plain"],
	".png": ["image/png"],
	".jpg": ["image/jpeg"],
	".jpeg": ["image/jpeg"],
	".webp": ["image/webp"],
	".gif": ["image/gif"],
	".mp4": ["video/mp4"],
	".webm": ["video/webm"],
	".pdf": ["application/pdf", "application/octet-stream"],
};

export class MediaContract {
	constructor(courseId, required) {
		this.courseId = courseId;
		this.required = required || {
			hero_image: 1,
			thumbnail: 1,
			module_images: 3,
			diagrams: 2,
			trailer_video: 1,
			lesson_videos: 3,
			video_thumbnails: 3,
			cheat_sheet: 1,
		};
		this.results = {};
	}

	static registry() {
		if (fs.existsSync(REGISTRY_FILE)) {
			try {
				return JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8"));
			} catch {
				return { version: CONTRACT_VERSION, assets: {}, updated_at: null };
			}
		}
		return { version: CONTRACT_VERSION, assets: {}, updated_at: null };
	}

	static saveRegistry(reg) {
		fs.mkdirSync(REGISTRY_DIR, { recursive: true });
		reg.updated_at = new Date().toISOString();
		fs.writeFileSync(REGISTRY_FILE, JSON.stringify(reg, null, 2));
		return REGISTRY_FILE;
	}

	short() {
		return this.courseId.replace(/RWC-([A-Z]+)-\d{3}-/, "");
	}

	assetId(kind, idx) {
		const short = this.short();
		return `${short}-${kind}${idx ? "-" + String(idx).padStart(2, "0") : ""}`;
	}

	checkQuantity(kind, actual, min) {
		const pass = typeof actual === "number" && actual >= (min || 1);
		this.results[kind] = {
			kind,
			required: min || 1,
			found: actual,
			status: pass ? "PASS" : "FAIL",
			assetIds: [],
		};
		return pass;
	}

	fail(kind, reason, detail) {
		this.results[kind] = {
			kind,
			required: this.required[kind] || 1,
			found: 0,
			status: "FAIL",
			reason: reason || "not_found",
			detail: detail || null,
			assetIds: [],
		};
		return false;
	}
}

export function detectPlaceholderText(text) {
	const hits = [];
	for (const p of PLACEHOLDER_PATTERNS) {
		if (!p.re) continue;
		const m = p.re.exec(text || "");
		if (m) hits.push({ id: p.id, label: p.label, match: m[0], file: [p.id].shift() });
	}
	return hits;
}

export async function httpCheck(url, { method = "GET" } = {}) {
	const res = await fetch(url, {
		method,
		redirect: "manual",
		headers: { "User-Agent": "MediaContractAudit/1.0 (realworldcerts QA)" },
		signal: AbortSignal.timeout(15000),
	});
	let body = null;
	if (res.ok) {
		body = await res.arrayBuffer();
	}
	return {
		status: res.status,
		ok: res.ok || res.status === 200,
		contentType: (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase(),
		contentLength: body ? body.byteLength : null,
		body,
		url: res.url || url,
		redirected: res.redirected,
	};
}

export function validateMime(url, contentType) {
	const ext = path.extname(new URL(url, "https://hold").pathname).toLowerCase();
	const okSet = MIME_OK[ext];
	if (!okSet) return null;
	return okSet.includes(contentType) ? null : `expected ${okSet.join("/")} got ${contentType}`;
}

export function fileSizeOk(contentLength) {
	return typeof contentLength === "number" && contentLength > 0;
}

export function isSameUnique(src, seen) {
	const clean = src.split("?")[0];
	const key = clean.toLowerCase();
	if (seen.has(key)) return true;
	seen.add(key);
	return false;
}