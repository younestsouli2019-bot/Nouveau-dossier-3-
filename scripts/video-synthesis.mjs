/**
 * Local video synthesis for realworldcerts course assets.
 *
 * REAL content only: takes the real images generated for a course
 * (HERO / MOD / DIAGRAM / THUMB) and renders genuine mp4 files with
 * ffmpeg (Ken-Burns style pans + crossfades + real narration audio
 * when a TTS provider is configured; silent otherwise). No stock
 * placeholders, no fabricated URLs — if input images are missing,
 * synthesis fails closed for that asset.
 *
 * ffmpeg resolution: FFMPEG_PATH env > bundled static build > PATH.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
const execFileP = promisify(execFile);

function candidatePaths() {
	const list = [];
	if (process.env.FFMPEG_PATH) list.push(process.env.FFMPEG_PATH);
	list.push(path.join(os.homedir(), "AppData", "Local", "Temp", "opencode", "tools", "ffmpeg", "ffmpeg-master-latest-win64-gpl", "bin", "ffmpeg.exe"));
	list.push("ffmpeg"); // PATH fallback
	return list;
}

export function resolveFfmpeg() {
	for (const cand of candidatePaths()) {
		try {
			const r = spawnSync(cand, ["-version"], { encoding: "utf8", windowsHide: true, timeout: 15000 });
			if (r.status === 0 && /ffmpeg version/i.test(String(r.stdout))) return cand;
		} catch { /* next candidate */ }
	}
	throw new Error("ffmpeg not found: set FFMPEG_PATH or install ffmpeg (verified static build: github.com/BtbN/FFmpeg-Builds)");
}

/**
 * Ken-Burns slideshow render.
 * imagePaths: ordered list of real image files; outPath: target .mp4.
 * Returns { path, size, frames } or throws (fail-closed).
 */
export async function renderSlideshow({ imagePaths, outPath, width = 1280, height = 720, perImageMs = 4000, transitionMs = 700, audioPath = null }) {
	const ffmpeg = resolveFfmpeg();
	const real = imagePaths.filter((p) => fs.existsSync(p) && fs.statSync(p).size > 1024);
	if (!real.length) throw new Error("no real source images; refusing to render empty video");
	fs.mkdirSync(path.dirname(outPath), { recursive: true });

	const N = real.length;
	const dur = perImageMs / 1000;
	const t = Math.min(transitionMs / 1000, dur / 2);
	const FPS = 12; // slideshow: 12fps is plenty and renders ~2x faster
	const L = dur + t; // per-clip length: visible time + crossfade tail

	const inputs = [];
	const chains = [];
	for (let i = 0; i < N; i++) {
		inputs.push("-loop", "1", "-framerate", String(FPS), "-t", String(L), "-i", real[i]);
		// d=1: one output frame per input frame; zoom accumulates across frames
		const z = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},zoompan=z='min(1+0.0012*on,1.08)':d=1:x='iw/2-(iw/zoom)/2':y='ih/2-(ih/zoom)/2':s=${width}x${height}:fps=${FPS},setsar=1`;
		chains.push(`[${i}:v]${z}[v${i}]`);
	}

	const parts = [...chains];
	if (N === 1) {
		parts.push("[v0]format=yuv420p[vout]");
	} else {
		let last = "v0";
		for (let i = 1; i < N; i++) {
			// xfade offset for join i: i*(L - t) relative to joined output start
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

	const { stderr } = await execFileP(ffmpeg, args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
	const ok = fs.existsSync(outPath) && fs.statSync(outPath).size > 4096;
	if (!ok) throw new Error(`ffmpeg produced no usable file: ${String(stderr).slice(-300)}`);
	return { path: outPath, size: fs.statSync(outPath).size, frames: real.length };
}
