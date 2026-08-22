import fs from "node:fs";
import path from "node:path";

export const STATUS = {
	DRAFT: "DRAFT",
	FORENSIC_REVIEW: "FORENSIC_REVIEW",
	VERIFIED_OUTBOUND: "VERIFIED_OUTBOUND",
	DISCREPANCY: "DISCREPANCY",
	ESCALATED: "ESCALATED",
	FOLLOW_UP_1: "FOLLOW_UP_1",
	FOLLOW_UP_2: "FOLLOW_UP_2",
	PHONE_ESCALATION: "PHONE_ESCALATION",
	RESOLVED: "RESOLVED",
	HITL: "HITL",
};

const TRANSITIONS = {
	DRAFT: [STATUS.FORENSIC_REVIEW, STATUS.HITL],
	FORENSIC_REVIEW: [STATUS.VERIFIED_OUTBOUND, STATUS.DISCREPANCY, STATUS.HITL],
	VERIFIED_OUTBOUND: [STATUS.ESCALATED, STATUS.DISCREPANCY, STATUS.HITL],
	DISCREPANCY: [STATUS.ESCALATED, STATUS.HITL],
	ESCALATED: [STATUS.FOLLOW_UP_1, STATUS.FOLLOW_UP_2, STATUS.RESOLVED, STATUS.HITL],
	FOLLOW_UP_1: [STATUS.FOLLOW_UP_2, STATUS.FOLLOW_UP_1, STATUS.RESOLVED, STATUS.HITL],
	FOLLOW_UP_2: [STATUS.PHONE_ESCALATION, STATUS.FOLLOW_UP_2, STATUS.RESOLVED, STATUS.HITL],
	PHONE_ESCALATION: [STATUS.RESOLVED, STATUS.HITL],
	RESOLVED: [],
	HITL: [STATUS.RESOLVED, STATUS.ESCALATED],
};

export const COMPLIANCE_FLAGS = {
	AML_HOLD: "aml_hold",
	KYC_PENDING: "kyc_pending",
	SANCTIONS_MATCH: "sanctions_match",
	REGULATORY_HOLD_CODE: "regulatory_hold_code",
};

const CASE_DIR = () => path.resolve(process.cwd(), "data", "escalation", "cases");

function ensureDir() {
	fs.mkdirSync(CASE_DIR(), { recursive: true });
}

export function listCases() {
	ensureDir();
	return fs
		.readdirSync(CASE_DIR())
		.filter((f) => f.endsWith(".json"))
		.map((f) => JSON.parse(fs.readFileSync(path.join(CASE_DIR(), f), "utf8")))
		.sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1));
}

export function loadCase(caseId) {
	ensureDir();
	const file = path.join(CASE_DIR(), `${caseId}.json`);
	if (!fs.existsSync(file)) throw new Error(`Case not found: ${caseId}`);
	return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function saveCase(caseData) {
	ensureDir();
	const file = path.join(CASE_DIR(), `${caseData.id}.json`);
	fs.writeFileSync(file, JSON.stringify(caseData, null, 2), "utf8");
	return caseData;
}

export function transitionTo(caseData, to, { reason, actor } = {}) {
	if (caseData.status === to) return caseData;
	const allowed = TRANSITIONS[caseData.status] || [];
	if (!allowed.includes(to)) {
		throw new Error(`Illegal transition ${caseData.status} -> ${to}`);
	}
	caseData.status = to;
	caseData.statusHistory = caseData.statusHistory || [];
	caseData.statusHistory.push({
		from: caseData.statusHistory.length ? caseData.statusHistory[caseData.statusHistory.length - 1].to : null,
		to,
		reason: reason || "",
		actor: actor || "EscalationAgent",
		at: new Date().toISOString(),
	});
	return caseData;
}

export function createCase({ payload, actor }) {
	const id = `ESC-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
	const caseData = {
		id,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		status: STATUS.DRAFT,
		statusHistory: [],
		trigger: payload.trigger || "A-02_MANUAL_COMPLAINT",
		complaint: payload,
		forensic: null,
		dispatches: [],
		followups: [],
		responses: [],
		complianceFlags: [],
		hitl: null,
	};
	transitionTo(caseData, STATUS.FORENSIC_REVIEW, { reason: "Ingestion complete", actor });
	return saveCase(caseData);
}

export function touch(caseData) {
	caseData.updatedAt = new Date().toISOString();
	return saveCase(caseData);
}
