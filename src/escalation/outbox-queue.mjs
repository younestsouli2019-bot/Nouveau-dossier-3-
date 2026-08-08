import fs from "node:fs";
import path from "node:path";
import { sendEmail } from "./email-sender.mjs";
import { appendAudit } from "./audit.mjs";

const QUEUE_FILE = () => path.resolve(process.cwd(), "data", "escalation", "state", "outbox-queue.json");

function ensureDir() {
	fs.mkdirSync(path.dirname(QUEUE_FILE()), { recursive: true });
}

export function loadQueue() {
	ensureDir();
	if (!fs.existsSync(QUEUE_FILE())) return [];
	try {
		const parsed = JSON.parse(fs.readFileSync(QUEUE_FILE(), "utf8"));
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

export function saveQueue(queue) {
	ensureDir();
	fs.writeFileSync(QUEUE_FILE(), JSON.stringify(queue, null, 2), "utf8");
}

export function enqueueEmail({ caseId, to, cc, from, subject, body, step, draftFile }) {
	const queue = loadQueue();
	const existing = queue.find((item) => item.caseId === caseId && item.step === step && item.status === "pending");
	if (existing) {
		existing.attempts = existing.attempts || 0;
		existing.lastEnqueuedAt = new Date().toISOString();
		saveQueue(queue);
		return existing;
	}
	const item = {
		id: `SMTPQ_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
		caseId,
		step,
		to,
		cc,
		from,
		subject,
		body,
		draftFile,
		status: "pending",
		attempts: 0,
		nextAttemptAt: null,
		createdAt: new Date().toISOString(),
		lastError: null,
	};
	queue.push(item);
	saveQueue(queue);
	return item;
}

export function nextRetryMs(attempt, { base = 60000, cap = 4 * 3600000 } = {}) {
	return Math.min(cap, base * 2 ** Math.max(0, attempt - 1));
}

export function dueItems({ now = new Date() } = {}) {
	return loadQueue().filter((item) => item.status === "pending" && (!item.nextAttemptAt || new Date(item.nextAttemptAt) <= now));
}

export function markAttempt(item, { ok, error, nextAttemptAt }) {
	const queue = loadQueue();
	const stored = queue.find((q) => q.id === item.id);
	if (!stored) return;
	stored.attempts += 1;
	stored.lastAttemptAt = new Date().toISOString();
	if (ok) {
		stored.status = "sent";
		stored.sentAt = new Date().toISOString();
		stored.lastError = null;
	} else {
		stored.status = "pending";
		stored.lastError = error;
		stored.nextAttemptAt = nextAttemptAt?.toISOString() ?? null;
	}
	saveQueue(queue);
}

export function requeueAllPending({ caseId, step, to, cc, from, subject, body, draftFile }) {
	enqueueEmail({ caseId, to, cc, from, subject, body, step, draftFile });
}

export async function flushQueue({ env = process.env, live = true } = {}) {
	const queue = loadQueue();
	if (queue.every((q) => q.status !== "pending")) return { flushed: 0, sent: 0, failed: 0, remaining: 0 };
	const due = dueItems();
	let sent = 0;
	let failed = 0;
	for (const item of due) {
		if (!live) break;
		try {
			const result = await sendEmail({
				to: item.to,
				cc: item.cc,
				from: item.from,
				subject: item.subject,
				body: item.body,
				env,
			});
			markAttempt(item, { ok: true });
			appendAudit({
				action: "OUTBOX_FLUSH_SENT",
				entityId: item.caseId,
				actor: "EscalationQueue",
				changes: { queueId: item.id, step: item.step, to: item.to },
			});
			sent += 1;
		} catch (err) {
			const retryMs = nextRetryMs(item.attempts + 1);
			markAttempt(item, { ok: false, error: err.message, nextAttemptAt: new Date(Date.now() + retryMs) });
			appendAudit({
				action: "OUTBOX_FLUSH_RETRY_SCHEDULED",
				entityId: item.caseId,
				actor: "EscalationQueue",
				changes: { queueId: item.id, step: item.step, attempts: item.attempts + 1, retryInMs: retryMs, error: err.message },
			});
			failed += 1;
		}
	}
	const remaining = loadQueue().filter((q) => q.status === "pending").length;
	return { flushed: due.length, sent, failed, remaining };
}

export function queueReport() {
	const queue = loadQueue();
	return {
		total: queue.length,
		pending: queue.filter((q) => q.status === "pending").length,
		sent: queue.filter((q) => q.status === "sent").length,
		items: queue.map((q) => ({ id: q.id, caseId: q.caseId, step: q.step, status: q.status, attempts: q.attempts, nextAttemptAt: q.nextAttemptAt })),
	};
}
