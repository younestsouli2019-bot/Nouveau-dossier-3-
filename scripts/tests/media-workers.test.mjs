import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ComfyUIVideoWorker } from "../edu-ai-comfyui-video.mjs";
import { resolveAudioBed } from "../edu-ace-step-audio.mjs";
import { publishPromoAsset } from "../promo-publish-protocol.mjs";

test("ComfyUI client queues, polls and downloads the actual output descriptor", async () => {
	let submitted;
	const server = createServer(async (req, res) => {
		if (req.url === "/prompt") {
			let body = "";
			for await (const chunk of req) body += chunk;
			submitted = JSON.parse(body);
			res.end(JSON.stringify({ prompt_id: "job1" }));
		} else if (req.url === "/history/job1") {
			res.end(JSON.stringify({ job1: { status: { completed: true }, outputs: {} } }));
		} else if (req.url.startsWith("/view?")) {
			const query = new URL(req.url, "http://localhost").searchParams;
			assert.equal(query.get("filename"), "clip name.mp4");
			assert.equal(query.get("subfolder"), "nested");
			assert.equal(query.get("type"), "temp");
			res.end("rendered bytes");
		} else {
			res.writeHead(404).end();
		}
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const dir = await mkdtemp(path.join(os.tmpdir(), "comfy-test-"));
	try {
		const worker = new ComfyUIVideoWorker(`127.0.0.1:${server.address().port}`);
		assert.equal(await worker.queuePrompt({ 1: { class_type: "SaveVideo" } }), "job1");
		assert.equal(submitted.prompt[1].class_type, "SaveVideo");
		assert.equal((await worker.pollExecution("job1")).status.completed, true);
		const target = path.join(dir, "nested", "clip.mp4");
		await worker.fetchOutputMedia({ videos: [{ filename: "clip name.mp4", subfolder: "nested", type: "temp" }] }, target);
		assert.equal(await readFile(target, "utf8"), "rendered bytes");
		await assert.rejects(worker.fetchOutputMedia({}, target), /output filename/);
	} finally {
		await new Promise((resolve) => server.close(resolve));
		await rm(dir, { recursive: true, force: true });
	}
});

test("ComfyUI client reports execution and HTTP failures", async () => {
	const server = createServer((req, res) => {
		if (req.url === "/history/error") {
			res.end(JSON.stringify({ error: { status: { status_str: "error", messages: ["failed"] } } }));
		} else if (req.url === "/history/wait") {
			res.end("{}");
		} else {
			res.writeHead(500).end("failed");
		}
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		const worker = new ComfyUIVideoWorker(`127.0.0.1:${server.address().port}`);
		await assert.rejects(worker.queuePrompt({}), /500/);
		await assert.rejects(worker.pollExecution("error", 100, 5), /execution failed/);
		await assert.rejects(worker.pollExecution("wait", 30, 5), /timed out/);
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
});

test("audio profiles require real WAV files and never silently fall back", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "audio-test-"));
	try {
		const sourceDir = path.join(dir, "CRIMSON_Noir_Vocals");
		await mkdir(sourceDir);
		const source = path.join(sourceDir, "CRIMSON_NOIR_Master_with_Real_Vocals.wav");
		const wav = Buffer.from("524946462600000057415645666d7420100000000100010044ac0000885801000200100064617461020000000000", "hex");
		await writeFile(source, wav);
		const out = await resolveAudioBed({ id: "scene1", audio_profile: "CRIMSON_NOIR" }, path.join(dir, "out"), { assetRoot: dir });
		assert.deepEqual(await readFile(out), wav);
		await assert.rejects(resolveAudioBed({ id: "../escape", audio_profile: "THE_RUPTURE" }, dir), /sceneSpec.id/);
		await assert.rejects(resolveAudioBed({ id: "scene", audio_profile: "THE_RUPTURE" }, dir, { assetRoot: dir }), /ENOENT/);
		await assert.rejects(resolveAudioBed({ id: "scene", audio_profile: "OTHER" }, dir), /Unknown audio profile/);
		await assert.rejects(resolveAudioBed({ id: "scene", audio_prompt: "music" }, dir, { runnerPath: path.join(dir, "missing.py") }), /ENOENT/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("publishing requires explicit approval before side effects", async () => {
	await assert.rejects(publishPromoAsset({}), /approval/);
	await assert.rejects(publishPromoAsset({ approved: true }), /mp4Path/);
});
