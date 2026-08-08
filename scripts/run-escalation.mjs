import fs from "node:fs";
import path from "node:path";
import {
	createCase,
	loadCase,
	listCases,
	saveCase,
	transitionTo,
	touch,
	STATUS,
	COMPLIANCE_FLAGS,
} from "../src/escalation/escalation-case.mjs";
import { runForensicValidation } from "../src/escalation/forensic-validator.mjs";
import { appendAudit } from "../src/escalation/audit.mjs";
import { dispatchEmail, dispatchSwiftGpi, dispatchSmsWhatsApp, generatePdfDossier } from "../src/escalation/comms.mjs";
import { escalationEmail, followUpEmail, escalationLetterSections } from "../src/escalation/templates.mjs";
import { dueActions, businessHoursElapsed } from "../src/escalation/followup-scheduler.mjs";

const DEFAULT_PAYLOAD = path.resolve(process.cwd(), "data", "escalation", "payload-mt103-tsouli.json");

function parseArgs(argv) {
	const args = {};
	for (let i = 2; i < argv.length; i++) {
		const arg = argv[i];
		if (arg.startsWith("--")) {
			const key = arg.slice(2);
			const next = argv[i + 1];
			if (next && !next.startsWith("--")) {
				args[key] = next;
				i++;
			} else {
				args[key] = true;
			}
		}
	}
	return args;
}

function loadPayload(p) {
	const file = path.resolve(process.cwd(), p || DEFAULT_PAYLOAD);
	if (!fs.existsSync(file)) throw new Error(`Payload file not found: ${file}`);
	return JSON.parse(fs.readFileSync(file, "utf8"));
}

function actorName() {
	return "EscalationAgent";
}

async function performDispatch({ caseData, forensic, override }) {
	const fromHitl = caseData.status === STATUS.HITL;
	if (fromHitl) {
		transitionTo(caseData, STATUS.ESCALATED, { reason: override ? "Owner LIVE override approved" : "Forensic gate PASS", actor: actorName() });
	} else {
		transitionTo(caseData, STATUS.VERIFIED_OUTBOUND, { reason: override ? "Owner LIVE override approved" : "Forensic gate PASS", actor: actorName() });
	}
	const email = escalationEmail({ caseData });
	const dispatch = dispatchEmail({
		caseId: caseData.id,
		to: caseData.complaint.bankContact,
		cc: "operations-escalations@platform.com",
		from: "treasury-automation@realworldcerts.com",
		subject: email.subject,
		body: email.body,
		step: "escalation-01",
	});
	caseData.dispatchedAt = new Date().toISOString();
	caseData.escrowTimestamp = caseData.dispatchedAt;
	caseData.dispatches.push(dispatch);
	await generatePdfDossier({
		caseId: caseData.id,
		title: "Letter of Escalation - Missing MT103 Wires",
		sections: escalationLetterSections({ caseData, forensic }),
	});
	const gpi = dispatchSwiftGpi({ caseId: caseData.id, batches: caseData.complaint.batches || [], step: "escalation-01" });
	caseData.dispatches.push(gpi);
	transitionTo(caseData, STATUS.ESCALATED, { reason: "Phase 2 dispatch complete", actor: actorName() });
	appendAudit({
		action: override ? "ESCALATION_DISPATCHED_LIVE" : "ESCALATION_DISPATCHED",
		entityId: caseData.id,
		actor: actorName(),
		changes: { to: dispatch.to, subject: dispatch.subject, mode: dispatch.mode, ownerOverride: Boolean(override) },
	});
	return dispatch;
}

async function cmdCreate({ args }) {	const payload = loadPayload(args.create === true ? undefined : args.create);
	const caseData = createCase({ payload, actor: actorName() });
	appendAudit({ action: "CASE_CREATED", entityId: caseData.id, actor: actorName(), changes: { status: caseData.status } });

	const forensic = runForensicValidation(payload);
	caseData.forensic = forensic;
	appendAudit({
		action: "FORENSIC_VALIDATION",
		entityId: caseData.id,
		actor: actorName(),
		changes: { decision: forensic.decision, reason: forensic.reason, gate: forensic.gate },
	});

	if (forensic.gate === "PASS") {
		const dispatch = await performDispatch({ caseData, forensic });
		saveCase(caseData);
		return { ok: true, caseId: caseData.id, status: caseData.status, forensic: { decision: forensic.decision, gate: forensic.gate }, dispatch: { to: dispatch.to, mode: dispatch.mode } };
	}
	if (args.live) {
		caseData.ownerOverride = {
			type: "owner_approval",
			reason: args["override-reason"] || "Owner reviewed HITL queue and approved live dispatch",
			decidedBy: args["decided-by"] || "owner",
			at: new Date().toISOString(),
		};
		appendAudit({
			action: "OWNER_LIVE_OVERRIDE",
			entityId: caseData.id,
			actor: actorName(),
			changes: { gate: forensic.gate, reason: caseData.ownerOverride.reason },
		});
		const dispatch = await performDispatch({ caseData, forensic, override: true });
		saveCase(caseData);
		return { ok: true, caseId: caseData.id, status: caseData.status, forensic: { decision: forensic.decision, gate: forensic.gate }, ownerOverride: caseData.ownerOverride, dispatch: { to: dispatch.to, mode: dispatch.mode } };
	} else {
		transitionTo(caseData, STATUS.DISCREPANCY, { reason: forensic.reason, actor: actorName() });
		transitionTo(caseData, STATUS.HITL, { reason: "Forensic gate requires human review", actor: actorName() });
		caseData.hitl = {
			type: "Tier3HumanOps",
			reason: forensic.reason,
			decision: forensic.decision,
			raisedAt: new Date().toISOString(),
		};
		appendAudit({
			action: "CASE_HITL",
			entityId: caseData.id,
			actor: actorName(),
			changes: { hitlType: caseData.hitl.type, reason: forensic.reason },
		});
	}

	saveCase(caseData);
	return { ok: true, caseId: caseData.id, status: caseData.status, forensic: { decision: forensic.decision, gate: forensic.gate } };
}

async function cmdDispatchLive({ args }) {
	const caseData = loadCase(args["dispatch-live"]);
	const eligible = [STATUS.HITL, STATUS.DISCREPANCY, STATUS.FORENSIC_REVIEW];
	if (!eligible.includes(caseData.status)) {
		return { ok: true, caseId: caseData.id, status: caseData.status, note: "Case not awaiting live dispatch" };
	}
	const forensic = caseData.forensic || runForensicValidation(caseData.complaint);
	caseData.forensic = forensic;
	caseData.ownerOverride = {
		type: "owner_approval",
		reason: args["override-reason"] || "Owner reviewed HITL queue and approved live dispatch",
		decidedBy: args["decided-by"] || "owner",
		at: new Date().toISOString(),
	};
	appendAudit({
		action: "OWNER_LIVE_OVERRIDE",
		entityId: caseData.id,
		actor: actorName(),
		changes: { gate: forensic.gate, reason: caseData.ownerOverride.reason },
	});
	const dispatch = await performDispatch({ caseData, forensic, override: true });
	saveCase(caseData);
	return { ok: true, caseId: caseData.id, status: caseData.status, forensic: { decision: forensic.decision, gate: forensic.gate }, ownerOverride: caseData.ownerOverride, dispatch: { to: dispatch.to, mode: dispatch.mode } };
}

function cmdAdvance({ args, now = new Date() }) {
	const caseData = loadCase(args.advance);
	const eligible = [STATUS.ESCALATED, STATUS.FOLLOW_UP_1, STATUS.FOLLOW_UP_2];
	if (!eligible.includes(caseData.status)) {
		return { ok: true, caseId: caseData.id, status: caseData.status, businessHoursElapsed: 0, actionsDispatched: 0, note: "Case not in an active follow-up window" };
	}
	const hours = businessHoursElapsed(caseData.escrowTimestamp || caseData.dispatchedAt || caseData.updatedAt, now);
	const actions = dueActions({ caseData, now });
	for (const action of actions) {
		const email = followUpEmail({ caseData, stage: action.step });
		const cc = action.step === "FOLLOW_UP_2" ? "reclamation@attijariwafa.com" : undefined;
		const dispatch = dispatchEmail({
			caseId: caseData.id,
			to: caseData.complaint.bankContact,
			cc,
			from: "treasury-automation@realworldcerts.com",
			subject: email.subject,
			body: email.body,
			step: `followup-${caseData.followups.length + 1}`,
		});
		caseData.followups.push({
			kind: "chaser",
			step: action.step,
			reason: action.reason,
			dispatchedAt: new Date().toISOString(),
			dispatch,
		});
		if (action.step === "FOLLOW_UP_2") {
			caseData.dispatches.push(dispatchSmsWhatsApp({
				caseId: caseData.id,
				to: caseData.complaint.ownerContact || "",
				message: `Mise à jour: escalade MT103 case ${caseData.id} - $${caseData.complaint.totalAmount}`,
				step: action.step,
			}));
		}
		if (action.step === "FOLLOW_UP_1") transitionTo(caseData, STATUS.FOLLOW_UP_1, { reason: action.reason, actor: actorName() });
		if (action.step === "FOLLOW_UP_2") transitionTo(caseData, STATUS.FOLLOW_UP_2, { reason: action.reason, actor: actorName() });
		if (action.step === "PHONE_ESCALATION") {
			transitionTo(caseData, STATUS.PHONE_ESCALATION, { reason: action.reason, actor: actorName() });
			caseData.hitl = {
				type: "PhoneOperations",
				reason: "Zero response after 3 automated attempts (72 business hours). Direct voice contact with Bank Relationship Manager required.",
				raisedAt: new Date().toISOString(),
			};
		}
		appendAudit({
			action: "FOLLOW_UP_DISPATCHED",
			entityId: caseData.id,
			actor: actorName(),
			changes: { step: action.step, reason: action.reason },
		});
	}
	saveCase(caseData);
	return { ok: true, caseId: caseData.id, status: caseData.status, businessHoursElapsed: hours, actionsDispatched: actions.length };
}

function cmdRespond({ args }) {
	const caseData = loadCase(args.respond);
	const file = path.resolve(process.cwd(), args.response || args.file || "");
	if (!fs.existsSync(file)) throw new Error(`Response file not found: ${file}`);
	const text = fs.readFileSync(file, "utf8");
	const lower = text.toLowerCase();
	const flags = [];
	if (/aml|anti[ -]money|regulatory hold/i.test(lower)) flags.push(COMPLIANCE_FLAGS.AML_HOLD);
	if (/kyc|know your customer/i.test(lower)) flags.push(COMPLIANCE_FLAGS.KYC_PENDING);
	if (/sanctions/i.test(lower)) flags.push(COMPLIANCE_FLAGS.SANCTIONS_MATCH);
	if (/held|hold|routing pool|intermediary/i.test(lower)) flags.push(COMPLIANCE_FLAGS.REGULATORY_HOLD_CODE);
	const noRecord = /no record|reject|not found|introuvable|rejet/i.test(lower);
	caseData.complianceFlags = [...new Set([...(caseData.complianceFlags || []), ...flags])];
	caseData.responses.push({ file: path.relative(process.cwd(), file), text: text.slice(0, 2000), receivedAt: new Date().toISOString() });
	appendAudit({ action: "RESPONSE_INGESTED", entityId: caseData.id, actor: actorName(), changes: { flags } });

	if (noRecord || flags.length > 0) {
		transitionTo(caseData, STATUS.HITL, { reason: noRecord ? "Bank reports no record/rejection" : "Regulatory hold code detected", actor: actorName() });
		caseData.hitl = {
			type: noRecord ? "SeniorTreasuryOperations" : "ComplianceOfficer",
			reason: noRecord ? "Bank claims no record or rejected query. Unified summary dashboard prepared for Senior Treasury Operations Specialist." : "Regulatory compliance flags detected; Compliance Officer Agent takes over communication.",
			raisedAt: new Date().toISOString(),
		};
		appendAudit({ action: "CASE_HITL", entityId: caseData.id, actor: actorName(), changes: { hitlType: caseData.hitl.type } });
	} else {
		transitionTo(caseData, STATUS.RESOLVED, { reason: "Bank provided MT103/SWIFT status copy", actor: actorName() });
		appendAudit({ action: "CASE_RESOLVED", entityId: caseData.id, actor: actorName(), changes: { via: "bank_provided_copy" } });
	}
	saveCase(caseData);
	return { ok: true, caseId: caseData.id, status: caseData.status, complianceFlags: caseData.complianceFlags, hitl: caseData.hitl };
}

function main() {
	const args = parseArgs(process.argv);
	if (args.create) {
		cmdCreate({ args }).then((r) => {
			console.log(JSON.stringify(r, null, 2));
		}).catch((e) => {
			console.error(e.message);
			process.exit(1);
		});
		return;
	}
	if (args["dispatch-live"]) {
		cmdDispatchLive({ args }).then((r) => {
			console.log(JSON.stringify(r, null, 2));
		}).catch((e) => {
			console.error(e.message);
			process.exit(1);
		});
		return;
	}
	if (args.advance) {
		console.log(JSON.stringify(cmdAdvance({ args }), null, 2));
		return;
	}
	if (args.respond) {
		console.log(JSON.stringify(cmdRespond({ args }), null, 2));
		return;
	}
	if (args.status) {
		console.log(JSON.stringify(loadCase(args.status), null, 2));
		return;
	}
	if (args.list) {
		console.log(JSON.stringify(listCases().map((c) => ({ id: c.id, status: c.status, total: c.complaint.totalAmount, createdAt: c.createdAt })), null, 2));
		return;
	}
	console.log(
		[
			"Usage: node scripts/run-escalation.mjs --create [payload.json] [--live [--override-reason X] [--decided-by owner]]",
			"       node scripts/run-escalation.mjs --dispatch-live <caseId> [--override-reason X] [--decided-by owner]",
			"       node scripts/run-escalation.mjs --advance <caseId>",
			"       node scripts/run-escalation.mjs --respond <caseId> <response.txt>",
			"       node scripts/run-escalation.mjs --status <caseId>",
			"       node scripts/run-escalation.mjs --list",
		].join("\n"),
	);
}

main();
