import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "./utils/cli.mjs";

function readRawBody(req, { limitBytes }) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > limitBytes) {
				reject(new Error("Request body too large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}

function json(res, status, data) {
	const body = JSON.stringify(data);
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Content-Length": Buffer.byteLength(body),
	});
	res.end(body);
}

function getPathname(req) {
	try {
		const raw = req?.url ?? "/";
		const u = new URL(raw, "http://localhost");
		const p = u.pathname || "/";
		if (p.length > 1 && p.endsWith("/")) return p.slice(0, -1);
		return p;
	} catch {
		return "/";
	}
}

function ensureLogDir() {
	const dir = path.resolve("out", "wise");
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

function appendEventLog(evt) {
	const dir = ensureLogDir();
	const f = path.join(dir, "webhooks.jsonl");
	fs.appendFileSync(f, `${JSON.stringify(evt)}\n`, "utf8");
}

function buildServer({ port = 5056, pathPrefix = "/callback" } = {}) {
	return http.createServer(async (req, res) => {
		const method = String(req.method || "GET").toUpperCase();
		const p = getPathname(req);
		if (method !== "POST" || p !== pathPrefix) {
			json(res, 404, { ok: false });
			return;
		}
		let raw = "";
		try {
			raw = await readRawBody(req, { limitBytes: 1024 * 1024 });
		} catch {
			json(res, 413, { ok: false });
			return;
		}
		let parsed = null;
		try {
			parsed = JSON.parse(raw);
		} catch {
			parsed = { raw };
		}
		const hdrs = {};
		for (const k of Object.keys(req.headers || {})) {
			hdrs[k.toLowerCase()] = req.headers[k];
		}
		const evt = {
			received_at: new Date().toISOString(),
			headers: hdrs,
			body: parsed,
		};
		appendEventLog(evt);
		json(res, 200, { ok: true });
	});
}

async function main() {
	const args = parseArgs(process.argv);
	const port = Number(args.port ?? process.env.WISE_WEBHOOK_PORT ?? "5056");
	const pathPrefix =
		String(args.path ?? process.env.WISE_WEBHOOK_PATH ?? "/callback") || "/callback";
	const server = buildServer({ port, pathPrefix });
	server.listen(port, () => {
		process.stdout.write(
			JSON.stringify({ ok: true, listening: `http://localhost:${port}${pathPrefix}` }) +
				"\n",
		);
	});
}

main().catch((e) => {
	process.stderr.write(String(e?.message ?? e) + "\n");
	process.exitCode = 1;
});
