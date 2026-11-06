import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class ComfyUIVideoWorker {
	constructor(serverAddress = "127.0.0.1:8188") {
		this.baseUrl = new URL(serverAddress.includes("://") ? serverAddress : `http://${serverAddress}`);
		if (!["http:", "https:"].includes(this.baseUrl.protocol) || this.baseUrl.username || this.baseUrl.password) {
			throw new Error("ComfyUI address must be an HTTP(S) URL without credentials");
		}
		this.clientId = `nouveau-video-${randomUUID()}`;
	}

	async request(endpoint, options = {}) {
		const response = await fetch(new URL(endpoint, this.baseUrl), {
			...options,
			signal: options.signal ?? AbortSignal.timeout(30000),
		});
		if (!response.ok) {
			throw new Error(`ComfyUI ${endpoint} failed (${response.status}): ${(await response.text()).slice(0, 1000)}`);
		}
		return response;
	}

	async queuePrompt(workflowJson) {
		if (!workflowJson || typeof workflowJson !== "object" || Array.isArray(workflowJson)) {
			throw new TypeError("ComfyUI workflow must be an API-format prompt object");
		}
		const response = await this.request("/prompt", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ prompt: workflowJson, client_id: this.clientId }),
		});
		const data = await response.json();
		if (typeof data.prompt_id !== "string" || !data.prompt_id) {
			throw new Error(`ComfyUI returned no prompt_id: ${JSON.stringify(data)}`);
		}
		return data.prompt_id;
	}

	async pollExecution(promptId, timeoutMs = 300000, pollIntervalMs = 3000) {
		if (typeof promptId !== "string" || !promptId || !Number.isFinite(timeoutMs) || timeoutMs <= 0 ||
			!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
			throw new TypeError("A prompt ID and positive finite timeout and poll interval are required");
		}
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const remaining = deadline - Date.now();
			let response;
			try {
				response = await this.request(`/history/${encodeURIComponent(promptId)}`, {
					signal: AbortSignal.timeout(Math.max(1, Math.min(remaining, 30000))),
				});
			} catch (error) {
				if (Date.now() >= deadline) {
					throw new Error(`ComfyUI execution timed out for ${promptId} after ${timeoutMs}ms`, { cause: error });
				}
				throw error;
			}
			const history = await response.json();
			const entry = history[promptId];
			if (entry?.status?.status_str === "error") {
				throw new Error(`ComfyUI execution failed for ${promptId}: ${JSON.stringify(entry.status.messages ?? [])}`);
			}
			if (entry?.status?.completed) return entry;
			const wait = Math.min(pollIntervalMs, deadline - Date.now());
			if (wait > 0) await delay(wait);
		}
		throw new Error(`ComfyUI execution timed out for ${promptId} after ${timeoutMs}ms`);
	}

	async fetchOutputMedia(nodeOutput, destPath) {
		const media = nodeOutput?.videos?.[0] ?? nodeOutput?.images?.[0];
		if (!media || typeof media.filename !== "string" || !media.filename ||
			typeof destPath !== "string" || !destPath) {
			throw new Error("A ComfyUI output filename and destination path are required");
		}
		const query = new URLSearchParams({
			filename: media.filename,
			subfolder: media.subfolder ?? "",
			type: media.type ?? "output",
		});
		const response = await this.request(`/view?${query}`);
		if (!response.body) throw new Error("ComfyUI returned an empty media response");
		await mkdir(path.dirname(path.resolve(destPath)), { recursive: true });
		const temporaryPath = `${destPath}.${randomUUID()}.tmp`;
		try {
			await pipeline(Readable.fromWeb(response.body), createWriteStream(temporaryPath, { flags: "wx" }));
			await rename(temporaryPath, destPath);
		} catch (error) {
			await rm(temporaryPath, { force: true });
			throw error;
		}
		return destPath;
	}
}
