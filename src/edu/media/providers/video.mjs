import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { VideoProvider } from "./interfaces.mjs";
const execFileP = promisify(execFile);

function ffmpegCandidatePaths() {
	const list = [];
	if (process.env.FFMPEG_PATH) list.push(process.env.FFMPEG_PATH);
	list.push(path.join(os.homedir(), "AppData", "Local", "Temp", "opencode", "tools", "ffmpeg", "ffmpeg-master-latest-win64-gpl", "bin", "ffmpeg.exe"));
	list.push("ffmpeg");
	return list;
}

export function resolveFfmpegBinary() {
	for (const cand of ffmpegCandidatePaths()) {
		try {
			const r = spawnSync(cand, ["-version"], { encoding: "utf8", windowsHide: true, timeout: 15000 });
			if (r.status === 0 && /ffmpeg version/i.test(String(r.stdout))) return cand;
		} catch { /* continue */ }
	}
	throw new Error("ffmpeg not found: set FFMPEG_PATH or install ffmpeg (verified static build: github.com/BtbN/FFmpeg-Builds)");
}

export class OmniVideoFactory extends VideoProvider {
	constructor(config = {}) {
		super({
			providerName: "omni-video-factory",
			brandName: "OmniVideoFactory",
			weight: 88,
			requiresKey: true,
			isFree: false,
			...config,
		});
		this.apiKey = process.env.OMNI_VIDEO_API_KEY || process.env.VIDEO_GEN_API_KEY || process.env.REPLICATE_API_TOKEN || process.env.GOOGLE_AI_STUDIO_KEY || "";
		this.apiUrl = process.env.OMNI_VIDEO_API_URL || "https://api.replicate.com/v1/predictions";
		this.model = process.env.OMNI_VIDEO_MODEL || process.env.VIDEO_GEN_MODEL || "stability-ai/stable-video-diffusion:3f0457e4619daac51203dedb472816fd4af51f3149fa7a9e0b5ffcf1b8172438";
	}

	hasKey() {
		return Boolean(this.apiKey && this.apiKey.length > 0);
	}

	async _ffmpegFallback({ imagePaths, outPath, width, height, audioPath, perImageMs = 3000, transitionMs = 600 }) {
		return FfmpegSlideshowProvider._renderFfmpeg({ imagePaths, outPath, width, height, audioPath, perImageMs, transitionMs });
	}

	async generate({ prompt, outPath, imagePaths = [], width = 1280, height = 720, audioPath = null, durationSec = 10, seed = null, model = null }) {
		const useModel = model || this.model;
		const input = { prompt, imagePaths, width, height, durationSec, seed, model: useModel, provider: this.providerName };
		const ext = path.extname(outPath)?.replace(/^\./, "") || "mp4";
		const cached = this.cacheRead(input, ext);
		if (cached) {
			fs.mkdirSync(path.dirname(outPath), { recursive: true });
			fs.copyFileSync(cached.path, outPath);
			return { path: outPath, cached: true, provider: this.providerName, brand: this.brandName };
		}
		if (!this.hasKey() || !imagePaths?.length) {
			if (imagePaths?.length) {
				const r = await this._ffmpegFallback({ imagePaths, outPath, width, height, audioPath });
				this.cacheWrite(input, ext, r.path);
				this.recordSpend({ kind: "video", model: "ffmpeg-slideshow (omni-fallback)", width, height, bytes: fs.statSync(r.path).size, fallback: true, audio: Boolean(audioPath) });
				return { ...r, provider: this.providerName, brand: this.brandName, fallback: "ffmpeg" };
			}
			throw new Error(`OmniVideoFactory: no API key and no source images for ffmpeg fallback`);
		}
		try {
			const firstImg = imagePaths?.[0];
			const headers = {
				Authorization: `Token ${this.apiKey}`,
				"Content-Type": "application/json",
			};
			const payload = {
				version: useModel.split(":").slice(-1)[0] || useModel,
				input: {
					prompt,
					duration: Math.min(durationSec, 14),
					...(firstImg && fs.existsSync(firstImg) ? { input_image: `data:image/${path.extname(firstImg).replace(/^\./, "") || "png"};base64,${fs.readFileSync(firstImg).toString("base64")}` } : {}),
					...(seed != null ? { seed } : {}),
				},
			};
			const res = await fetch(this.apiUrl, {
				method: "POST", headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(180000),
			});
			if (!res.ok) throw new Error(`OmniVideoFactory submit ${res.status}: ${await res.text()}`);
			const job = await res.json();
			const pollUrl = job.urls?.get || job.id ? `${this.apiUrl.replace(/\/predictions.*/, "/predictions")}/${job.id}` : null;
			if (!pollUrl) throw new Error(`OmniVideoFactory submit returned no poll URL`);
			const deadline = Date.now() + 600_000;
			let videoUrl = null;
			while (Date.now() < deadline) {
				await new Promise((r) => setTimeout(r, 8000));
				const chk = await fetch(pollUrl, { headers: { Authorization: `Token ${this.apiKey}` }, signal: AbortSignal.timeout(30000) });
				if (!chk.ok) continue;
				const c = await chk.json();
				if (c.status === "succeeded") { videoUrl = c.output || c.output?.[0]; break; }
				if (c.status === "failed" || c.error) throw new Error(`OmniVideoFactory failed: ${c.error || JSON.stringify(c).slice(0, 200)}`);
			}
			if (!videoUrl) throw new Error(`OmniVideoFactory timed out`);
			const vbuf = await fetch(videoUrl, { signal: AbortSignal.timeout(120000) }).then((r) => r.arrayBuffer());
			fs.mkdirSync(path.dirname(outPath), { recursive: true });
			fs.writeFileSync(outPath, Buffer.from(vbuf));
			if (audioPath && fs.existsSync(audioPath)) {
				const ffmpeg = resolveFfmpegBinary();
				const tmp = outPath + ".tmp.mp4";
				fs.renameSync(outPath, tmp);
				await execFileP(ffmpeg, [
					"-y", "-i", tmp, "-i", audioPath,
					"-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-shortest",
					"-movflags", "+faststart", outPath,
				], { windowsHide: true, maxBuffer: 64 * 1024 * 1024 }).catch(() => { fs.renameSync(tmp, outPath); });
				if (fs.existsSync(tmp)) try { fs.unlinkSync(tmp); } catch {}
			}
			const size = fs.statSync(outPath).size;
			this.cacheWrite(input, ext, outPath);
			this.recordSpend({ kind: "video", model: useModel, width, height, durationSec, bytes: size, audio: Boolean(audioPath) });
			return { path: outPath, cached: false, provider: this.providerName, brand: this.brandName, size };
		} catch (e) {
			if (imagePaths?.length) {
				const r = await this._ffmpegFallback({ imagePaths, outPath, width, height, audioPath });
				this.cacheWrite(input, ext, r.path);
				this.recordSpend({ kind: "video", model: "ffmpeg-slideshow (omni-error fallback)", width, height, bytes: fs.statSync(r.path).size, fallback: true, fallbackReason: String(e?.message || e).slice(0, 120), audio: Boolean(audioPath) });
				return { ...r, provider: this.providerName, brand: this.brandName, fallback: "ffmpeg", fallbackReason: e?.message || String(e) };
			}
			throw e;
		}
	}
}

export class ArenaAiVideo extends VideoProvider {
	constructor(config = {}) {
		super({
			providerName: "arena-ai-video",
			brandName: "ArenaAiVideo",
			weight: 78,
			requiresKey: true,
			isFree: false,
			...config,
		});
		this.apiKey = process.env.ARENA_VIDEO_API_KEY || process.env.VIDEO_GEN_API_KEY || process.env.RUNWAY_API_KEY || "";
		this.apiUrl = process.env.ARENA_VIDEO_API_URL || "https://api.runwayml.com/v1/image_to_video";
		this.model = process.env.ARENA_VIDEO_MODEL || process.env.VIDEO_GEN_MODEL || "gen3";
	}

	hasKey() {
		return Boolean(this.apiKey && this.apiKey.length > 0);
	}

	async generate({ prompt, outPath, imagePaths = [], width = 1280, height = 720, audioPath = null, durationSec = 10, seed = null, model = null }) {
		const useModel = model || this.model;
		const input = { prompt, imagePaths, width, height, durationSec, seed, model: useModel, provider: this.providerName };
		const ext = path.extname(outPath)?.replace(/^\./, "") || "mp4";
		const cached = this.cacheRead(input, ext);
		if (cached) {
			fs.mkdirSync(path.dirname(outPath), { recursive: true });
			fs.copyFileSync(cached.path, outPath);
			return { path: outPath, cached: true, provider: this.providerName, brand: this.brandName };
		}
		if (!this.hasKey() || !imagePaths?.length) {
			throw new Error(`ArenaAiVideo: missing API key (set ARENA_VIDEO_API_KEY or VIDEO_GEN_API_KEY or RUNWAY_API_KEY) and requires source images`);
		}
		try {
			const firstImg = imagePaths[0];
			if (!fs.existsSync(firstImg)) throw new Error(`ArenaAiVideo: source image not found: ${firstImg}`);
			const form = new FormData();
			const imgBuf = fs.readFileSync(firstImg);
			form.append("promptImage", new Blob([imgBuf], { type: `image/${path.extname(firstImg).replace(/^\./, "") || "png"}` }), path.basename(firstImg));
			form.append("promptText", prompt);
			form.append("model", useModel);
			form.append("duration", String(Math.min(durationSec, 10)));
			if (seed != null) form.append("seed", String(seed));
			const res = await fetch(this.apiUrl, {
				method: "POST",
				headers: { Authorization: `Bearer ${this.apiKey}` },
				body: form,
				signal: AbortSignal.timeout(180000),
			});
			if (!res.ok) throw new Error(`ArenaAiVideo submit ${res.status}: ${await res.text()}`);
			const job = await res.json();
			const taskId = job.id || job.taskId;
			if (!taskId) throw new Error(`ArenaAiVideo submit no task id`);
			const deadline = Date.now() + 600_000;
			let videoUrl = null;
			const statusUrl = `${this.apiUrl.replace(/\/image_to_video.*/, "")}/tasks/${taskId}`;
			while (Date.now() < deadline) {
				await new Promise((r) => setTimeout(r, 10000));
				const chk = await fetch(statusUrl, { headers: { Authorization: `Bearer ${this.apiKey}` }, signal: AbortSignal.timeout(30000) });
				if (!chk.ok) continue;
				const c = await chk.json();
				if (c.status === "succeeded" || c.state === "COMPLETED") { videoUrl = c.output || c.videoUrl || c.output?.[0]; break; }
				if (c.status === "failed" || c.state === "FAILED" || c.error) throw new Error(`ArenaAiVideo failed: ${c.error || JSON.stringify(c).slice(0, 200)}`);
			}
			if (!videoUrl) throw new Error(`ArenaAiVideo timed out`);
			const vbuf = await fetch(videoUrl, { signal: AbortSignal.timeout(120000) }).then((r) => r.arrayBuffer());
			fs.mkdirSync(path.dirname(outPath), { recursive: true });
			fs.writeFileSync(outPath, Buffer.from(vbuf));
			if (audioPath && fs.existsSync(audioPath)) {
				const ffmpeg = resolveFfmpegBinary();
				const tmp = outPath + ".tmp.mp4";
				fs.renameSync(outPath, tmp);
				await execFileP(ffmpeg, [
					"-y", "-i", tmp, "-i", audioPath,
					"-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-shortest",
					"-movflags", "+faststart", outPath,
				], { windowsHide: true, maxBuffer: 64 * 1024 * 1024 }).catch(() => { fs.renameSync(tmp, outPath); });
				if (fs.existsSync(tmp)) try { fs.unlinkSync(tmp); } catch {}
			}
			const size = fs.statSync(outPath).size;
			this.cacheWrite(input, ext, outPath);
			this.recordSpend({ kind: "video", model: useModel, width, height, durationSec, bytes: size, audio: Boolean(audioPath) });
			return { path: outPath, cached: false, provider: this.providerName, brand: this.brandName, size };
		} catch (e) {
			throw e;
		}
	}
}

export class FfmpegSlideshowProvider extends VideoProvider {
	constructor(config = {}) {
		super({
			providerName: "ffmpeg-slideshow",
			brandName: "FfmpegSlideshow",
			weight: 50,
			requiresKey: false,
			isFree: true,
			...config,
		});
	}

	hasKey() {
		return true;
	}

	isAvailable() {
		try { resolveFfmpegBinary(); return true; } catch { return false; }
	}

	static _renderFfmpeg({ imagePaths, outPath, width = 1280, height = 720, perImageMs = 4000, transitionMs = 700, audioPath = null }) {
		const ffmpeg = resolveFfmpegBinary();
		const real = imagePaths.filter((p) => fs.existsSync(p) && fs.statSync(p).size > 1024);
		if (!real.length) throw new Error("no real source images; refusing to render empty video");
		fs.mkdirSync(path.dirname(outPath), { recursive: true });
		const N = real.length;
		const dur = perImageMs / 1000;
		const t = Math.min(transitionMs / 1000, dur / 2);
		const FPS = 12;
		const L = dur + t;
		const inputs = [];
		const chains = [];
		for (let i = 0; i < N; i++) {
			inputs.push("-loop", "1", "-framerate", String(FPS), "-t", String(L), "-i", real[i]);
			const z = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},zoompan=z='min(1+0.0012*on,1.08)':d=1:x='iw/2-(iw/zoom)/2':y='ih/2-(ih/zoom)/2':s=${width}x${height}:fps=${FPS},setsar=1`;
			chains.push(`[${i}:v]${z}[v${i}]`);
		}
		const parts = [...chains];
		if (N === 1) {
			parts.push("[v0]format=yuv420p[vout]");
		} else {
			let last = "v0";
			for (let i = 1; i < N; i++) {
				const offset = (i * (L - t)).toFixed(2);
				const out = i === N - 1 ? "vpre" : `vx${i}`;
				parts.push(`[${last}][v${i}]xfade=transition=fade:duration=${t}:offset=${offset}[${out}]`);
				last = out;
			}
			parts.push("[vpre]format=yuv420p[vout]");
		}
		const graph = parts.join(";");
		const args = ["-y", ...inputs, "-filter_complex", graph, "-map", "[vout]"];
		if (audioPath && fs.existsSync(audioPath)) {
			args.push("-i", audioPath, "-map", `${N}:a`, "-c:a", "aac", "-b:a", "128k", "-shortest");
		}
		args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart", outPath);
		return execFileP(ffmpeg, args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024 }).then(({ stderr }) => {
			const ok = fs.existsSync(outPath) && fs.statSync(outPath).size > 4096;
			if (!ok) throw new Error(`ffmpeg produced no usable file: ${String(stderr).slice(-300)}`);
			return { path: outPath, size: fs.statSync(outPath).size, frames: real.length };
		});
	}

	async generate({ prompt, outPath, imagePaths = [], width = 1280, height = 720, audioPath = null, durationSec = 10, seed = null, model = null }) {
		const perImageMs = imagePaths?.length ? Math.max(1500, Math.floor((durationSec * 1000) / imagePaths.length)) : 4000;
		const transitionMs = Math.min(700, Math.floor(perImageMs / 5));
		const input = { prompt, imagePaths, width, height, perImageMs, transitionMs, audioPath, provider: this.providerName };
		const ext = path.extname(outPath)?.replace(/^\./, "") || "mp4";
		const cached = this.cacheRead(input, ext);
		if (cached) {
			fs.mkdirSync(path.dirname(outPath), { recursive: true });
			fs.copyFileSync(cached.path, outPath);
			return { path: outPath, cached: true, provider: this.providerName, brand: this.brandName };
		}
		const r = await FfmpegSlideshowProvider._renderFfmpeg({ imagePaths, outPath, width, height, perImageMs, transitionMs, audioPath });
		this.cacheWrite(input, ext, r.path);
		this.recordSpend({ kind: "video", model: "ffmpeg-slideshow", width, height, frames: r.frames, bytes: r.size, free: true, audio: Boolean(audioPath) });
		return { ...r, cached: false, provider: this.providerName, brand: this.brandName };
	}
}

export const VIDEO_PROVIDERS = [
	OmniVideoFactory,
	ArenaAiVideo,
	FfmpegSlideshowProvider,
];
