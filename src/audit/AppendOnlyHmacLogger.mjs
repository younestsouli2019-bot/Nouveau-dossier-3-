import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

function hmac(text) {
	const key = String(process.env.APPEND_LOG_SECRET || "");
	if (!key) return null;
	return crypto.createHmac("sha256", key).update(text).digest("hex");
}

function append(line) {
	const dir = path.resolve("audits");
	const file = path.join(dir, "append-only-log.jsonl");
	fs.mkdirSync(dir, { recursive: true });
	fs.appendFileSync(file, line + "\n");
}

export class AppendOnlyHmacLogger {
	log(action, entityId, before, after, actor, meta = {}) {
		const payload = {
			ts: new Date().toISOString(),
			action,
			entity_id: entityId,
			actor,
			before,
			after,
			meta,
		};
		const text = JSON.stringify(payload);
		const sig = hmac(text);
		append(JSON.stringify({ payload, sig }));
		return true;
	}
	write(entry) {
		const text = JSON.stringify(entry);
		const sig = hmac(text);
		append(JSON.stringify({ payload: entry, sig }));
		return true;
	}
}
