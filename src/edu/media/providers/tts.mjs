import fs from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { TtsProvider } from "./interfaces.mjs";
const execFileP = promisify(execFile);

export class VibeVoiceTts extends TtsProvider {
	constructor(config = {}) {
		super({
			providerName: "vibe-voice-tts",
			brandName: "VibeVoice",
			weight: 85,
			requiresKey: true,
			isFree: false,
			...config,
		});
		this.apiKey = process.env.VIBEVOICE_API_KEY || process.env.ELEVENLABS_API_KEY || process.env.TTS_API_KEY || "";
		this.apiUrl = process.env.VIBEVOICE_API_URL || process.env.TTS_API_URL || "https://api.elevenlabs.io/v1/text-to-speech";
		this.voice = process.env.VIBEVOICE_VOICE || process.env.TTS_VOICE || "21m00Tcm4TlvDq8ikWAM";
		this.model = process.env.VIBEVOICE_MODEL || process.env.TTS_MODEL || "eleven_monolingual_v1";
	}

	hasKey() {
		return Boolean(this.apiKey && this.apiKey.length > 0);
	}

	async synthesize({ text, outPath, voice = null, language = "en-US", rate = 1.0, model = null }) {
		const useVoice = voice || this.voice;
		const useModel = model || this.model;
		const input = { text, voice: useVoice, language, rate, model: useModel, provider: this.providerName };
		const ext = path.extname(outPath)?.replace(/^\./, "") || "mp3";
		const cached = this.cacheRead(input, ext);
		if (cached) {
			fs.mkdirSync(path.dirname(outPath), { recursive: true });
			fs.copyFileSync(cached.path, outPath);
			return { path: outPath, cached: true, provider: this.providerName, brand: this.brandName, durationSec: null };
		}
		if (!this.hasKey()) throw new Error(`VibeVoiceTts: missing API key (set VIBEVOICE_API_KEY, ELEVENLABS_API_KEY, or TTS_API_KEY)`);
		const endpoint = `${this.apiUrl.replace(/\/+$/, "")}/${useVoice}`;
		const payload = {
			text,
			model_id: useModel,
			voice_settings: {
				stability: 0.5,
				similarity_boost: 0.75,
				speed: rate,
			},
		};
		const res = await fetch(endpoint, {
			method: "POST",
			headers: {
				"xi-api-key": this.apiKey,
				"Content-Type": "application/json",
				Accept: "audio/mpeg",
			},
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(180000),
		});
		if (!res.ok) throw new Error(`VibeVoiceTts API ${res.status}: ${await res.text()}`);
		const buf = Buffer.from(await res.arrayBuffer());
		if (buf.length < 1024) throw new Error(`VibeVoiceTts returned suspiciously small audio (${buf.length} bytes)`);
		fs.mkdirSync(path.dirname(outPath), { recursive: true });
		fs.writeFileSync(outPath, buf);
		this.cacheWrite(input, ext, outPath);
		this.recordSpend({ kind: "tts", model: useModel, voice: useVoice, language, chars: text.length, bytes: buf.length });
		return { path: outPath, cached: false, provider: this.providerName, brand: this.brandName, bytes: buf.length, durationSec: null };
	}
}

export class FreeTtsFallback extends TtsProvider {
	constructor(config = {}) {
		super({
			providerName: "free-tts-fallback",
			brandName: "EdgeTTS",
			weight: 65,
			requiresKey: false,
			isFree: true,
			...config,
		});
		this.defaultVoice = process.env.EDGE_TTS_VOICE || process.env.TTS_VOICE || "en-US-ChristopherNeural";
		this.pythonBin = process.env.PYTHON_BIN || "python3";
	}

	hasKey() {
		return true;
	}

	async _probeEdgeTts() {
		return new Promise((resolve) => {
			const probe = spawn(this.pythonBin, ["-c", "import edge_tts; print('ok')"], {
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true,
			});
			let out = "";
			probe.stdout.on("data", (d) => (out += d.toString()));
			probe.on("error", () => resolve(false));
			probe.on("close", (code) => resolve(code === 0 && out.includes("ok")));
			setTimeout(() => resolve(false), 15000);
		});
	}

	async synthesize({ text, outPath, voice = null, language = "en-US", rate = 1.0, model = null }) {
		const useVoice = voice || this._defaultVoiceForLang(language) || this.defaultVoice;
		const input = { text, voice: useVoice, language, rate, provider: this.providerName };
		const ext = path.extname(outPath)?.replace(/^\./, "") || "mp3";
		const cached = this.cacheRead(input, ext);
		if (cached) {
			fs.mkdirSync(path.dirname(outPath), { recursive: true });
			fs.copyFileSync(cached.path, outPath);
			return { path: outPath, cached: true, provider: this.providerName, brand: this.brandName, durationSec: null };
		}
		const available = await this._probeEdgeTts();
		if (!available) throw new Error(`FreeTtsFallback: edge-tts not available. Install: pip install edge-tts`);
		fs.mkdirSync(path.dirname(outPath), { recursive: true });
		const rateStr = rate >= 1.0 ? `+${Math.round((rate - 1) * 100)}%` : `${Math.round((rate - 1) * 100)}%`;
		const scriptText = `
import asyncio, sys
import edge_tts
async def main():
    comm = edge_tts.Communicate(sys.argv[1], sys.argv[2], rate=sys.argv[3])
    await comm.save(sys.argv[4])
asyncio.run(main())
`.trim();
		const tmpScript = outPath + ".tts.py";
		fs.writeFileSync(tmpScript, scriptText);
		try {
			await execFileP(this.pythonBin, [tmpScript, text, useVoice, rateStr, outPath], {
				windowsHide: true,
				maxBuffer: 32 * 1024 * 1024,
				timeout: 300000,
			});
		} catch (e) {
			try { fs.unlinkSync(tmpScript); } catch {}
			throw new Error(`FreeTtsFallback edge-tts failed: ${e?.message || String(e)}`);
		}
		try { fs.unlinkSync(tmpScript); } catch {}
		const ok = fs.existsSync(outPath) && fs.statSync(outPath).size > 1024;
		if (!ok) throw new Error(`FreeTtsFallback edge-tts produced no usable audio file`);
		const bytes = fs.statSync(outPath).size;
		this.cacheWrite(input, ext, outPath);
		this.recordSpend({ kind: "tts", model: "edge-tts", voice: useVoice, language, chars: text.length, bytes, free: true });
		return { path: outPath, cached: false, provider: this.providerName, brand: this.brandName, bytes, durationSec: null };
	}

	_defaultVoiceForLang(lang) {
		const LANG_VOICE = {
			"en-US": "en-US-ChristopherNeural",
			"en-GB": "en-GB-RyanNeural",
			"fr-FR": "fr-FR-HenriNeural",
			"es-ES": "es-ES-AlvaroNeural",
			"de-DE": "de-DE-ConradNeural",
			"ar-XA": "ar-XA-HammadNeural",
			"zh-CN": "zh-CN-YunxiNeural",
			"ja-JP": "ja-JP-KeitaNeural",
		};
		return LANG_VOICE[lang] || null;
	}
}

export const TTS_PROVIDERS = [
	VibeVoiceTts,
	FreeTtsFallback,
];
