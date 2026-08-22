import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function walkAuditFiles(dir, out = []) {
	if (!fs.existsSync(dir)) return out;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) walkAuditFiles(full, out);
		else if (entry.name.endsWith(".jsonl")) out.push(full);
	}
	return out;
}

function scanAudits(tokens) {
	const auditRoot = path.join(ROOT, "audits");
	const hits = [];
	for (const file of walkAuditFiles(auditRoot)) {
		const lines = fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim());
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (tokens.some((t) => line.includes(t))) {
				hits.push({ file: path.relative(ROOT, file), line: i + 1, sample: line.slice(0, 400) });
			}
		}
	}
	return hits;
}

function scanReconciliation(tokens) {
	const file = path.join(ROOT, "reports", "reconciliation_report.csv");
	if (!fs.existsSync(file)) return { file: null, rows: [] };
	const lines = fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim());
	const rows = [];
	for (let i = 0; i < lines.length; i++) {
		if (tokens.some((t) => lines[i].includes(t))) {
			rows.push({ line: i + 1, row: lines[i].slice(0, 500) });
		}
	}
	return { file: "reports/reconciliation_report.csv", rows };
}

function checkHttpHandshake(valueDateIso) {
	const auditRoot = path.join(ROOT, "audits");
	const hits = [];
	for (const file of walkAuditFiles(auditRoot)) {
		const base = path.basename(file, ".jsonl");
		if (!base.includes(valueDateIso.slice(0, 10))) continue;
		const lines = fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim());
		for (let i = 0; i < lines.length; i++) {
			if (/"status"\s*:\s*"(success|processing)"/.test(lines[i]) || /200 OK|201 OK|200|201/.test(lines[i])) {
				hits.push({ file: path.relative(ROOT, file), line: i + 1, sample: lines[i].slice(0, 300) });
			}
		}
	}
	return hits;
}

function ribConsistency(rib) {
	const configured = String(process.env.MOROCCAN_BANK_RIB || "").trim();
	return {
		configured,
		matches: configured !== "" && configured.replace(/\s/g, "") === String(rib || "").replace(/\s/g, ""),
	};
}

export function runForensicValidation(payload) {
	const batchTokens = (payload.batches || []).map((b) => b.id);
	const tokens = [...batchTokens, String(payload.rib || "").replace(/\s/g, "")].filter(Boolean);
	const auditHits = scanAudits(tokens);
	const rec = scanReconciliation([...batchTokens, "Attijariwafa Bank"]);
	const handshake = checkHttpHandshake(payload.valueDate || payload.date || "");
	const rib = ribConsistency(payload.rib);
	const hasFailureEvidence = auditHits.some((h) => /FAILED|REJECTED/i.test(h.sample));
	const hasSuccessEvidence = auditHits.some(
		(h) => /BANK_WIRE|CRYPTO_TRANSFER|INITIATE_AUTO_SETTLEMENT|SETTLEMENT|PAYOUT/i.test(h.sample) && /success/i.test(h.sample),
	);
	const reconciliationGap = rec.rows.some((r) => /not_sent|absent_hard_bound_evidence/i.test(r.row));
	const ribMismatch = payload.rib && rib.configured && !rib.matches;

	let decision;
	let reason;
	if (hasFailureEvidence || ribMismatch) {
		decision = "FAILED_REJECTED";
		reason = hasFailureEvidence ? "Internal records show failed/rejected settlement evidence" : "Destination RIB differs from configured owner RIB";
	} else if (hasSuccessEvidence) {
		decision = "SUCCESS_OUTBOUND";
		reason = "Internal records show successful outbound settlement evidence";
	} else {
		decision = "NOT_FOUND_ON_RECORDS";
		reason = reconciliationGap
			? "No internal record of the claimed batches; reconciliation report shows the gateway as not_sent / absent hard-bound evidence"
			: "No internal record of the claimed batches or matching RIB settlement in audits/reconciliation";
	}

	return {
		decision,
		reason,
		auditHits: auditHits.length,
		auditSamples: auditHits.slice(0, 5),
		reconciliation: rec,
		reconciliationGap,
		httpHandshakeHits: handshake.length,
		httpHandshakeSamples: handshake.slice(0, 3),
		rib,
		gate: decision === "SUCCESS_OUTBOUND" ? "PASS" : "HITL",
	};
}
