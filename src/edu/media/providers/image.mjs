import fs from "node:fs";
import path from "node:path";
import { ImageProvider } from "./interfaces.mjs";

export class DeepAiDesignArena extends ImageProvider {
	constructor(config = {}) {
		super({
			providerName: "deepai-design-arena",
			brandName: "DeepAiDesignArena",
			weight: 85,
			requiresKey: true,
			isFree: false,
			...config,
		});
		this.apiKey = process.env.DEEPAI_API_KEY || process.env.IMAGE_GEN_API_KEY || "";
		this.apiUrl = process.env.DEEPAI_API_URL || "https://api.deepai.org/api/text2img";
		this.model = process.env.DEEPAI_MODEL || "standard";
	}

	hasKey() {
		return Boolean(this.apiKey && this.apiKey.length > 0);
	}

	async generate({ prompt, outPath, width = 1024, height = 1024, seed = null, model = null }) {
		const useModel = model || this.model;
		const input = { prompt, width, height, seed, model: useModel, provider: this.providerName };
		const ext = path.extname(outPath)?.replace(/^\./, "") || "jpg";
		const cached = this.cacheRead(input, ext);
		if (cached) {
			fs.mkdirSync(path.dirname(outPath), { recursive: true });
			fs.copyFileSync(cached.path, outPath);
			return { path: outPath, cached: true, provider: this.providerName, brand: this.brandName };
		}
		if (!this.hasKey()) throw new Error(`DeepAiDesignArena: missing API key (set DEEPAI_API_KEY or IMAGE_GEN_API_KEY)`);
		const form = new FormData();
		form.append("text", prompt);
		form.append("width", String(width));
		form.append("height", String(height));
		if (seed != null) form.append("seed", String(seed));
		const res = await fetch(this.apiUrl, {
			method: "POST",
			headers: { "api-key": this.apiKey },
			body: form,
			signal: AbortSignal.timeout(120000),
		});
		if (!res.ok) throw new Error(`DeepAiDesignArena API ${res.status}: ${await res.text()}`);
		const data = await res.json();
		const imgUrl = data?.output_url || data?.url;
		if (!imgUrl) throw new Error(`DeepAiDesignArena returned no output_url`);
		const imgRes = await fetch(imgUrl, { signal: AbortSignal.timeout(60000) });
		if (!imgRes.ok) throw new Error(`DeepAiDesignArena image download ${imgRes.status}`);
		const buf = Buffer.from(await imgRes.arrayBuffer());
		fs.mkdirSync(path.dirname(outPath), { recursive: true });
		fs.writeFileSync(outPath, buf);
		this.cacheWrite(input, ext, outPath);
		this.recordSpend({ kind: "image", model: useModel, width, height, bytes: buf.length, outputUrl: imgUrl });
		return { path: outPath, cached: false, provider: this.providerName, brand: this.brandName, publicUrl: imgUrl };
	}
}

export class PlaygroundImage extends ImageProvider {
	constructor(config = {}) {
		super({
			providerName: "playground-image",
			brandName: "Pollinations",
			weight: 92,
			requiresKey: false,
			isFree: true,
			...config,
		});
		this.baseUrl = process.env.POLLINATIONS_URL || process.env.PLAYGROUND_IMAGE_URL || "https://image.pollinations.ai";
		this.model = process.env.POLLINATIONS_MODEL || process.env.PLAYGROUND_IMAGE_MODEL || "flux";
	}

	hasKey() {
		return true;
	}

	async generate({ prompt, outPath, width = 1024, height = 1024, seed = null, model = null }) {
		const useModel = model || this.model;
		const useSeed = seed ?? Math.floor(Math.random() * 1_000_000_000);
		const input = { prompt, width, height, seed: useSeed, model: useModel, provider: this.providerName };
		const ext = path.extname(outPath)?.replace(/^\./, "") || "jpg";
		const cached = this.cacheRead(input, ext);
		if (cached) {
			fs.mkdirSync(path.dirname(outPath), { recursive: true });
			fs.copyFileSync(cached.path, outPath);
			return { path: outPath, cached: true, provider: this.providerName, brand: this.brandName };
		}
		const params = new URLSearchParams();
		params.set("prompt", prompt);
		params.set("width", String(width));
		params.set("height", String(height));
		params.set("seed", String(useSeed));
		params.set("model", useModel);
		params.set("nologo", "true");
		params.set("enhance", "true");
		const url = `${this.baseUrl.replace(/\/+$/, "")}/prompt?${params.toString()}`;
		const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
		if (!res.ok) throw new Error(`PlaygroundImage (Pollinations) API ${res.status}`);
		const buf = Buffer.from(await res.arrayBuffer());
		if (buf.length < 1024) throw new Error(`PlaygroundImage returned suspiciously small payload (${buf.length} bytes)`);
		fs.mkdirSync(path.dirname(outPath), { recursive: true });
		fs.writeFileSync(outPath, buf);
		this.cacheWrite(input, ext, outPath);
		this.recordSpend({ kind: "image", model: useModel, width, height, bytes: buf.length, free: true, publicUrl: url });
		return { path: outPath, cached: false, provider: this.providerName, brand: this.brandName, publicUrl: url };
	}
}

export const PollinationsImage = PlaygroundImage;

export class AiHorde extends ImageProvider {
	constructor(config = {}) {
		super({
			providerName: "aihorde",
			brandName: "AI Horde",
			weight: 70,
			requiresKey: false,
			isFree: true,
			...config,
		});
		this.apiKey = process.env.AIHORDE_API_KEY || "0000000000";
		this.apiUrl = "https://aihorde.net/api/v2/generate/async";
		this.model = process.env.AIHORDE_MODEL || "AlbedoBase XL (SDXL)";
		this.clientAgent = process.env.AIHORDE_CLIENT_AGENT || "rwc-course-media:1.0:email";
		this.timeoutMs = (parseInt(process.env.AIHORDE_TIMEOUT_MS, 10) || 10) * 60 * 1000;
		this.retries = parseInt(process.env.AIHORDE_RETRIES || "3", 10);
	}

	hasKey() {
		return process.env.AIHORDE_ENABLED === "1" || Boolean(this.apiKey);
	}

	isAvailable() {
		return process.env.AIHORDE_ENABLED === "1";
	}

	async generate({ prompt, outPath, width = 1024, height = 1024, seed = null, model = null }) {
		const useModel = model || this.model;
		const input = { prompt, width, height, seed, model: useModel, provider: this.providerName };
		const ext = path.extname(outPath)?.replace(/^\./, "") || "webp";
		const cached = this.cacheRead(input, ext);
		if (cached) {
			fs.mkdirSync(path.dirname(outPath), { recursive: true });
			fs.copyFileSync(cached.path, outPath);
			return { path: outPath, cached: true, provider: this.providerName, brand: this.brandName };
		}
		const HDR = {
			apikey: this.apiKey,
			"Content-Type": "application/json",
			"Client-Agent": this.clientAgent,
		};
		const w = Math.min(Math.round(width / 64) * 64, 1024);
		const h = Math.min(Math.round(height / 64) * 64, 1024);
		let lastErr = null;
		for (let attempt = 1; attempt <= this.retries; attempt++) {
			if (attempt > 1) await new Promise((r) => setTimeout(r, 20000 * attempt));
			try {
				const result = await this._submitOnce(HDR, { prompt, w, h, model: useModel, seed });
				fs.mkdirSync(path.dirname(outPath), { recursive: true });
				const finalPath = outPath.endsWith(".png") ? outPath.replace(/\.png$/, ".webp") : outPath;
				fs.writeFileSync(finalPath, result.buffer);
				this.cacheWrite(input, ext, finalPath);
				this.recordSpend({ kind: "image", model: useModel, width: w, height: h, bytes: result.buffer.length, free: true, publicUrl: result.publicUrl, censored: result.censored });
				return { path: finalPath, cached: false, provider: this.providerName, brand: this.brandName, publicUrl: result.publicUrl, censored: result.censored };
			} catch (e) {
				lastErr = e;
			}
		}
		throw lastErr;
	}

	async _submitOnce(HDR, { prompt, w, h, model, seed }) {
		const submit = await fetch(this.apiUrl, {
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
					...(seed != null ? { seed: String(seed) } : {}),
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
		const started = Date.now();
		let done = false;
		while (!done) {
			if (Date.now() - started > this.timeoutMs) throw new Error(`AI Horde job ${job.id} timed out`);
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
		const gen = st.generations?.[0];
		if (!gen?.img) throw new Error(`AI Horde returned no image`);
		const imgRes = await fetch(gen.img, { signal: AbortSignal.timeout(60000) });
		if (!imgRes.ok) throw new Error(`AI Horde image download ${imgRes.status}`);
		const buffer = Buffer.from(await imgRes.arrayBuffer());
		if (buffer.length < 1024) throw new Error(`AI Horde image suspiciously small (${buffer.length} bytes)`);
		return { buffer, publicUrl: gen.img, censored: gen.censored || false };
	}
}

export class TogetherImageProvider extends ImageProvider {
	constructor(config = {}) {
		super({
			providerName: "together-image",
			brandName: "Together",
			weight: 80,
			requiresKey: true,
			isFree: false,
			...config,
		});
		this.apiKey = process.env.IMAGE_GEN_API_KEY || process.env.TOGETHER_API_KEY || "";
		this.apiUrl = process.env.IMAGE_GEN_API_URL || "https://api.together.xyz/v1/images/generations";
		this.model = process.env.IMAGE_GEN_MODEL || process.env.TOGETHER_IMAGE_MODEL || "black-forest-labs/FLUX.1-schnell";
	}

	hasKey() {
		return Boolean(this.apiKey && this.apiKey.length > 0);
	}

	async generate({ prompt, outPath, width = 1024, height = 1024, seed = null, model = null }) {
		const useModel = model || this.model;
		const input = { prompt, width, height, seed, model: useModel, provider: this.providerName };
		const ext = path.extname(outPath)?.replace(/^\./, "") || "png";
		const cached = this.cacheRead(input, ext);
		if (cached) {
			fs.mkdirSync(path.dirname(outPath), { recursive: true });
			fs.copyFileSync(cached.path, outPath);
			return { path: outPath, cached: true, provider: this.providerName, brand: this.brandName };
		}
		if (!this.hasKey()) throw new Error(`Together: missing API key (set IMAGE_GEN_API_KEY or TOGETHER_API_KEY)`);
		const headers = {
			Authorization: `Bearer ${this.apiKey}`,
			"Content-Type": "application/json",
		};
		const payload = {
			prompt,
			model: useModel,
			width,
			height,
			response_format: "b64_json",
			steps: useModel.includes("schnell") ? 4 : undefined,
			...(seed != null ? { seed } : {}),
		};
		const res = await fetch(this.apiUrl, {
			method: "POST", headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(120000),
		});
		if (!res.ok) throw new Error(`Together Image API ${res.status}: ${await res.text()}`);
		const data = await res.json();
		const b64 = data?.data?.[0]?.b64_json || data?.images?.[0]?.b64_json || data?.data?.[0]?.url;
		if (!b64) throw new Error("Together returned no b64_json");
		fs.mkdirSync(path.dirname(outPath), { recursive: true });
		let bytes;
		if (typeof b64 === "string" && b64.startsWith("http")) {
			const imgRes = await fetch(b64, { signal: AbortSignal.timeout(60000) });
			if (!imgRes.ok) throw new Error(`Together image download ${imgRes.status}`);
			bytes = Buffer.from(await imgRes.arrayBuffer());
			fs.writeFileSync(outPath, bytes);
		} else {
			bytes = Buffer.from(b64, "base64");
			fs.writeFileSync(outPath, bytes);
		}
		this.cacheWrite(input, ext, outPath);
		this.recordSpend({ kind: "image", model: useModel, width, height, bytes: bytes.length });
		return { path: outPath, cached: false, provider: this.providerName, brand: this.brandName };
	}
}

export class OpenRouterImageProvider extends ImageProvider {
	constructor(config = {}) {
		super({
			providerName: "openrouter-image",
			brandName: "OpenRouter",
			weight: 60,
			requiresKey: true,
			isFree: false,
			...config,
		});
		this.apiKey = process.env.OPENROUTER_API_KEY || "";
		this.apiUrl = "https://openrouter.ai/api/v1/images/generations";
		this.model = process.env.IMAGE_GEN_MODEL || process.env.OPENROUTER_IMAGE_MODEL || "google/gemini-2.5-flash-image";
		this.referer = process.env.RWC_SITE_URL || "https://realworldcerts.com";
		this.siteTitle = "realworldcerts course assets";
	}

	hasKey() {
		return Boolean(this.apiKey && this.apiKey.length > 0);
	}

	async generate({ prompt, outPath, width = 1024, height = 1024, seed = null, model = null }) {
		const useModel = model || this.model;
		const input = { prompt, width, height, seed, model: useModel, provider: this.providerName };
		const ext = path.extname(outPath)?.replace(/^\./, "") || "png";
		const cached = this.cacheRead(input, ext);
		if (cached) {
			fs.mkdirSync(path.dirname(outPath), { recursive: true });
			fs.copyFileSync(cached.path, outPath);
			return { path: outPath, cached: true, provider: this.providerName, brand: this.brandName };
		}
		if (!this.hasKey()) throw new Error(`OpenRouter: missing API key (set OPENROUTER_API_KEY)`);
		const headers = {
			Authorization: `Bearer ${this.apiKey}`,
			"Content-Type": "application/json",
			"HTTP-Referer": this.referer,
			"X-Title": this.siteTitle,
		};
		const payload = {
			prompt,
			model: useModel,
			width,
			height,
			response_format: "b64_json",
			...(seed != null ? { seed } : {}),
		};
		const res = await fetch(this.apiUrl, {
			method: "POST", headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(120000),
		});
		if (!res.ok) throw new Error(`OpenRouter Image API ${res.status}: ${await res.text()}`);
		const data = await res.json();
		const b64 = data?.data?.[0]?.b64_json || data?.images?.[0]?.b64_json || data?.data?.[0]?.url;
		if (!b64) throw new Error("OpenRouter returned no b64_json");
		fs.mkdirSync(path.dirname(outPath), { recursive: true });
		let bytes;
		if (typeof b64 === "string" && b64.startsWith("http")) {
			const imgRes = await fetch(b64, { signal: AbortSignal.timeout(60000) });
			if (!imgRes.ok) throw new Error(`OpenRouter image download ${imgRes.status}`);
			bytes = Buffer.from(await imgRes.arrayBuffer());
			fs.writeFileSync(outPath, bytes);
		} else {
			bytes = Buffer.from(b64, "base64");
			fs.writeFileSync(outPath, bytes);
		}
		this.cacheWrite(input, ext, outPath);
		this.recordSpend({ kind: "image", model: useModel, width, height, bytes: bytes.length });
		return { path: outPath, cached: false, provider: this.providerName, brand: this.brandName };
	}
}

export const IMAGE_PROVIDERS = [
	PlaygroundImage,
	DeepAiDesignArena,
	TogetherImageProvider,
	AiHorde,
	OpenRouterImageProvider,
];
