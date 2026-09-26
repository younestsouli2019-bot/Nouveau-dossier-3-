import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const CACHE_DIR = path.join(ROOT, "data", "generated", "cache", "media");
const SPEND_FILE = path.join(ROOT, "data", "out", "ai-media-spend.ndjson");

export class MediaProvider {
	constructor(config = {}) {
		this.config = config;
		this.providerName = config.providerName || this.constructor.name;
		this.brandName = config.brandName || null;
		this.weight = config.weight ?? 50;
		this.requiresKey = config.requiresKey ?? true;
		this.isFree = config.isFree ?? false;
	}

	hasKey() {
		return true;
	}

	isAvailable() {
		if (this.requiresKey && !this.hasKey()) return false;
		return true;
	}

	getPriorityScore() {
		let score = this.weight;
		if (this.isFree) score += 30;
		if (this.hasKey()) score += 20;
		return score;
	}

	cacheKey(input) {
		const serialized = typeof input === "string" ? input : JSON.stringify(input);
		return crypto.createHash("sha256").update(serialized).digest("hex");
	}

	cachePath(input, ext) {
		const hash = this.cacheKey(input);
		const dir = path.join(CACHE_DIR, hash.slice(0, 2));
		return path.join(dir, `${hash}.${ext}`);
	}

	cacheRead(input, ext) {
		const p = this.cachePath(input, ext);
		if (fs.existsSync(p) && fs.statSync(p).size > 0) {
			return { path: p, cached: true };
		}
		return null;
	}

	cacheWrite(input, ext, bufferOrPath) {
		const p = this.cachePath(input, ext);
		fs.mkdirSync(path.dirname(p), { recursive: true });
		if (typeof bufferOrPath === "string" && fs.existsSync(bufferOrPath)) {
			fs.copyFileSync(bufferOrPath, p);
		} else if (Buffer.isBuffer(bufferOrPath)) {
			fs.writeFileSync(p, bufferOrPath);
		}
		return p;
	}

	recordSpend(details) {
		const entry = {
			ts: new Date().toISOString(),
			provider: this.providerName,
			brand: this.brandName || null,
			...details,
		};
		fs.mkdirSync(path.dirname(SPEND_FILE), { recursive: true });
		fs.appendFileSync(SPEND_FILE, JSON.stringify(entry) + "\n");
		return entry;
	}
}

export class ImageProvider extends MediaProvider {
	async generate({ prompt, outPath, width = 1024, height = 1024, seed = null, model = null }) {
		throw new Error("ImageProvider.generate() must be implemented by subclass");
	}
}

export class VideoProvider extends MediaProvider {
	async generate({ prompt, outPath, imagePaths = [], width = 1280, height = 720, audioPath = null, durationSec = 10, seed = null, model = null }) {
		throw new Error("VideoProvider.generate() must be implemented by subclass");
	}
}

export class TtsProvider extends MediaProvider {
	async synthesize({ text, outPath, voice = null, language = "en-US", rate = 1.0, model = null }) {
		throw new Error("TtsProvider.synthesize() must be implemented by subclass");
	}
}

export function ensureCacheDir() {
	fs.mkdirSync(CACHE_DIR, { recursive: true });
	return CACHE_DIR;
}

export function ensureSpendDir() {
	fs.mkdirSync(path.dirname(SPEND_FILE), { recursive: true });
	return SPEND_FILE;
}

export { CACHE_DIR, SPEND_FILE };
