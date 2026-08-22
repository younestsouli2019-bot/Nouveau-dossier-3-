import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_AUDIT_DIR = path.resolve(process.cwd(), "data", "escalation", "audit.jsonl");

export function auditSecret() {
	return String(process.env.ESCALATION_AUDIT_HMAC_SECRET || process.env.AUDIT_HMAC_SECRET || "").trim();
}

export function hashEntry(entry) {
	const secret = auditSecret();
	if (!secret) return "";
	return crypto
		.createHmac("sha256", secret)
		.update(JSON.stringify(entry))
		.digest("hex");
}

export function lastHmac(file = DEFAULT_AUDIT_DIR) {
	if (!fs.existsSync(file)) return "";
	const lines = fs
		.readFileSync(file, "utf8")
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
	if (lines.length === 0) return "";
	try {
		const last = JSON.parse(lines[lines.length - 1]);
		return last.hmac || "";
	} catch {
		return "";
	}
}

export function appendAudit({ action, entityId, actor, changes, context, file = DEFAULT_AUDIT_DIR }) {
	const timestamp = new Date().toISOString();
	const nonce = crypto.randomUUID();
	const entry = {
		id: `AUD_${Date.now()}_${nonce.slice(0, 8)}`,
		timestamp,
		action,
		entity_id: entityId,
		actor: actor || "EscalationAgent",
		changes,
		context: context || {},
		nonce,
		prev_hmac: lastHmac(file),
	};
	entry.hmac = hashEntry(entry);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.appendFileSync(file, JSON.stringify(entry) + "\n", "utf8");
	return entry;
}
