import { execFile } from "node:child_process";
import { copyFile, mkdir, open, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profiles = {
	CRIMSON_NOIR: "CRIMSON_Noir_Vocals/CRIMSON_NOIR_Master_with_Real_Vocals.wav",
	THE_RUPTURE: "the_rupture_dark_revenge.wav",
};

async function checkWav(filename) {
	const file = await open(filename, "r");
	try {
		const header = Buffer.alloc(12);
		const { bytesRead } = await file.read(header, 0, header.length, 0);
		const size = (await file.stat()).size;
		if (bytesRead !== 12 || header.toString("ascii", 0, 4) !== "RIFF" ||
			header.toString("ascii", 8, 12) !== "WAVE" || header.readUInt32LE(4) + 8 > size) {
			throw new Error(`Not a usable WAV file: ${filename}`);
		}
		let offset = 12;
		let formatOk = false;
		let dataOk = false;
		const end = header.readUInt32LE(4) + 8;
		while (offset + 8 <= end) {
			const chunk = Buffer.alloc(8);
			await file.read(chunk, 0, 8, offset);
			const length = chunk.readUInt32LE(4);
			const start = offset + 8;
			if (start + length > end) throw new Error(`Truncated WAV chunk: ${filename}`);
			if (chunk.toString("ascii", 0, 4) === "fmt " && length >= 16) {
				const format = Buffer.alloc(16);
				await file.read(format, 0, 16, start);
				formatOk = format.readUInt16LE(0) === 1 && format.readUInt16LE(2) > 0 &&
					format.readUInt32LE(4) === 44100 && format.readUInt16LE(12) > 0 &&
					[8, 16, 24, 32].includes(format.readUInt16LE(14));
			}
			if (chunk.toString("ascii", 0, 4) === "data" && length > 0) dataOk = true;
			offset = start + length + (length % 2);
		}
		if (!formatOk || !dataOk) throw new Error(`Expected non-empty 44.1 kHz PCM WAV: ${filename}`);
	} finally {
		await file.close();
	}
}

export async function resolveAudioBed(sceneSpec, outputDir, options = {}) {
	if (!sceneSpec || typeof sceneSpec.id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(sceneSpec.id)) {
		throw new TypeError("sceneSpec.id must contain only letters, digits, underscores or hyphens");
	}
	if (typeof outputDir !== "string" || !outputDir) throw new TypeError("outputDir is required");
	const target = path.join(outputDir, `${sceneSpec.id}_bed.wav`);
	const temp = `${target}.${randomUUID()}.tmp.wav`;
	await mkdir(outputDir, { recursive: true });
	try {
		if (sceneSpec.audio_profile) {
			if (!Object.hasOwn(profiles, sceneSpec.audio_profile)) {
				throw new Error(`Unknown audio profile: ${sceneSpec.audio_profile}`);
			}
			const source = path.resolve(options.assetRoot ?? root, profiles[sceneSpec.audio_profile]);
			await checkWav(source);
			await copyFile(source, temp);
		} else {
			if (typeof sceneSpec.audio_prompt !== "string" || !sceneSpec.audio_prompt.trim()) {
				throw new TypeError("audio_prompt is required for ACE-Step generation");
			}
			const duration = sceneSpec.duration ?? 30;
			if (!Number.isFinite(duration) || duration <= 0) throw new TypeError("duration must be positive and finite");
			const runner = path.resolve(options.runnerPath ?? path.join(root, "scripts/run_ace_step.py"));
			if (!(await stat(runner)).isFile()) throw new Error(`ACE-Step runner is not a file: ${runner}`);
			await execFileAsync(options.pythonPath ?? "python3", [
				runner, "--prompt", sceneSpec.audio_prompt, "--duration", String(duration),
				"--output", temp, "--backend", "pytorch_2b_turbo",
			], { timeout: options.timeoutMs ?? 3600000, maxBuffer: 1024 * 1024 });
		}
		await checkWav(temp);
		await rename(temp, target);
		return target;
	} catch (error) {
		await rm(temp, { force: true });
		throw error;
	}
}
