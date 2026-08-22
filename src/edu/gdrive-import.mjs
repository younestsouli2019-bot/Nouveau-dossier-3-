import fs from "node:fs";
import path from "node:path";
import { getEnvOrThrow, getEnvBool, eduFetch } from "./base-client.mjs";

const DRIVE_API = "https://www.googleapis.com/drive/v3";

function findClientSecret() {
	const candidates = [
		process.env.GDRIVE_CLIENT_SECRET_JSON,
		process.env.GOOGLE_APPLICATION_CREDENTIALS,
	];
	const jsonPath =
		process.env.GDRIVE_CREDENTIALS_FILE ?? process.env.GOOGLE_APPLICATION_CREDENTIALS;
	if (jsonPath && fs.existsSync(jsonPath)) {
		return JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
	}
	if (candidates[0]) {
		try {
			return JSON.parse(candidates[0]);
		} catch {
			/* not inline JSON */
		}
	}
	return null;
}

async function fetchAccessToken({ clientSecret, scope = "https://www.googleapis.com/auth/drive.readonly", fetchImpl = fetch }) {
	if (clientSecret?.type === "service_account") {
		if (!clientSecret.client_email || !clientSecret.private_key) {
			throw new Error("GDrive service account JSON missing client_email/private_key");
		}
		const jwtHeader = Buffer.from(
			JSON.stringify({ alg: "RS256", typ: "JWT" }),
		).toString("base64url");
		const now = Math.floor(Date.now() / 1000);
		const claim = {
			iss: clientSecret.client_email,
			scope,
			aud: "https://oauth2.googleapis.com/token",
			iat: now,
			exp: now + 3600,
		};
		const jwtClaim = Buffer.from(JSON.stringify(claim)).toString("base64url");
		const crypto = await import("node:crypto");
		const signature = crypto.createSign("RSA-SHA256");
		signature.update(`${jwtHeader}.${jwtClaim}`);
		const jwtSignature = signature.sign(clientSecret.private_key);
		const assertion = `${jwtHeader}.${jwtClaim}.${jwtSignature.toString("base64url")}`;

		const res = await fetchImpl("https://oauth2.googleapis.com/token", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
				assertion,
			}).toString(),
		});
		if (!res.ok) throw new Error(`GDrive token request failed (${res.status})`);
		const json = await res.json();
		return json.access_token;
	}

	const accessToken = process.env.GDRIVE_ACCESS_TOKEN;
	if (!accessToken) {
		throw new Error("GDrive requires access token (GDRIVE_ACCESS_TOKEN) or service account credentials");
	}
	return accessToken;
}

export class GDrivePrepTestImporter {
	constructor({ credentials, fetchImpl = fetch } = {}) {
		this.credentials = credentials ?? findClientSecret();
		this.fetchImpl = fetchImpl;
		this.token = null;
	}

	async _ensureToken() {
		if (!this.token) this.token = await fetchAccessToken({ clientSecret: this.credentials, fetchImpl: this.fetchImpl });
		return this.token;
	}

	async _drive(pathname, { method = "GET", headers } = {}) {
		const token = await this._ensureToken();
		return eduFetch({
			url: `${DRIVE_API}${pathname}`,
			method,
			headers: {
				Authorization: `Bearer ${token}`,
				...(headers ?? {}),
			},
			fetchImpl: this.fetchImpl,
		});
	}

	async listFolderFiles(folderId) {
		const q = `'${encodeURIComponent(folderId)}' in parents and trashed=false`;
		const res = await this._drive(`/files?q=${q}&fields=files(id,name,mimeType,size)&pageSize=1000`);
		return res?.files ?? [];
	}

	async downloadFile(fileId, mimeType = "application/octet-stream") {
		const token = await this._ensureToken();
		const res = await this.fetchImpl(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`, {
			method: "GET",
			headers: { Authorization: `Bearer ${token}` },
		});
		if (!res.ok) throw new Error(`GDrive download failed (${res.status})`);
		const contentType = res.headers.get("content-type") || mimeType;
		let ext = ".bin";
		if (contentType.includes("pdf")) ext = ".pdf";
		else if (contentType.includes("json")) ext = ".json";
		else if (contentType.includes("zip")) ext = ".zip";
		else if (contentType.includes("text")) ext = ".txt";
		const buf = Buffer.from(await res.arrayBuffer());
		return { buffer: buf, contentType, ext };
	}

	async importFolder({ folderId, destDir, courseName }) {
		const files = await this.listFolderFiles(folderId);
		if (!getEnvBool("GDRIVE_ENABLED", false)) {
			return { dryRun: true, count: files.length, courseName };
		}
		const outDir = destDir ?? path.join(process.cwd(), "content", "preptests", courseName || "default");
		fs.mkdirSync(outDir, { recursive: true });
		const imported = [];
		for (const file of files) {
			try {
				const { buffer, ext } = await this.downloadFile(file.id, file.mimeType);
				const safeName = file.name.replace(/[^\w.\- ]+/g, "_");
				const filePath = path.join(outDir, safeName.endsWith(ext) ? safeName : `${safeName}${ext}`);
				fs.writeFileSync(filePath, buffer);
				imported.push({ id: file.id, name: file.name, size: file.size, filePath });
			} catch (e) {
				imported.push({ id: file.id, name: file.name, error: e.message });
			}
		}
		return { dryRun: false, count: imported.length, courseName, imported, destDir: outDir };
	}
}

export default GDrivePrepTestImporter;

