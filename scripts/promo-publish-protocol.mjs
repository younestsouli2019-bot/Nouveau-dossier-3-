import { execFile } from "node:child_process";
import { appendFile, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function requireText(value, name) {
	if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} is required`);
}

async function post(url, options) {
	const response = await fetch(url, { ...options, redirect: "error", signal: AbortSignal.timeout(120000) });
	if (!response.ok) throw new Error(`Publishing request failed (${response.status}): ${(await response.text()).slice(0, 1000)}`);
	return response.json();
}

// Publishing is irreversible: callers must obtain explicit approval and verify rights first.
export async function publishPromoAsset({ mp4Path, metadata, peertubeConfig, pinataConfig, ledgerPath, approved }) {
	if (approved !== true) throw new Error("Explicit publication approval is required");
	requireText(mp4Path, "mp4Path");
	requireText(ledgerPath, "ledgerPath");
	requireText(metadata?.title, "metadata.title");
	requireText(metadata?.description, "metadata.description");
	requireText(metadata?.rightsStatement, "metadata.rightsStatement");
	requireText(peertubeConfig?.instanceUrl, "peertubeConfig.instanceUrl");
	requireText(peertubeConfig?.oauthToken, "peertubeConfig.oauthToken");
	if (pinataConfig) requireText(pinataConfig.jwt, "pinataConfig.jwt");
	if (!Number.isInteger(Number(peertubeConfig.channelId)) || Number(peertubeConfig.channelId) <= 0 ||
		!Number.isInteger(Number(peertubeConfig.licenceId)) || Number(peertubeConfig.licenceId) <= 0) {
		throw new TypeError("PeerTube channelId and licenceId must be positive integers");
	}
	const instance = new URL(peertubeConfig.instanceUrl);
	if (instance.username || instance.password || instance.search || instance.hash ||
		(instance.protocol !== "https:" && !(instance.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(instance.hostname)))) {
		throw new Error("PeerTube must use HTTPS, or HTTP on localhost, without embedded credentials");
	}
	const info = await stat(mp4Path);
	if (!info.isFile() || info.size === 0) throw new Error("mp4Path must be a non-empty file");
	const record = async (event, data) => appendFile(ledgerPath, `${JSON.stringify({
		event, title: metadata.title, timestamp: new Date().toISOString(), ...data,
	})}\n`);

	// Verify ledger writability before making any external changes.
	await record("publication_started", {});
	const { stdout } = await execFileAsync("ipfs", ["add", "-Q", mp4Path], { timeout: 120000 });
	const cid = stdout.trim();
	if (!/^[a-zA-Z0-9]+$/.test(cid)) throw new Error("Kubo did not return a valid CID");
	await record("ipfs_added", { cid });
	if (pinataConfig) {
		await post("https://api.pinata.cloud/pinning/pinByHash", {
			method: "POST",
			headers: { Authorization: `Bearer ${pinataConfig.jwt}`, "Content-Type": "application/json" },
			body: JSON.stringify({ hashToPin: cid, pinataMetadata: { name: metadata.title } }),
		});
		await record("pinata_requested", { cid });
	}
	const form = new FormData();
	form.append("channelId", String(peertubeConfig.channelId));
	form.append("name", metadata.title);
	form.append("privacy", "1");
	form.append("licence", String(peertubeConfig.licenceId));
	form.append("description", `${metadata.description}\n\nIPFS: ipfs://${cid}\n${metadata.rightsStatement}`);
	form.append("videofile", new Blob([await readFile(mp4Path)], { type: "video/mp4" }), path.basename(mp4Path));
	const data = await post(new URL("/api/v1/videos/upload", instance), {
		method: "POST",
		headers: { Authorization: `Bearer ${peertubeConfig.oauthToken}` },
		body: form,
	});
	if (!/^[a-zA-Z0-9_-]+$/.test(data?.video?.shortUUID ?? "")) {
		throw new Error(`PeerTube upload response missing video ID; check the instance before retrying. CID: ${cid}`);
	}
	const peertubeUrl = new URL(`/w/${data.video.shortUUID}`, instance).toString();
	await record("peertube_uploaded", { cid, peertubeUrl });
	return { peertubeUrl, ipfsCid: cid, status: "uploaded" };
}
