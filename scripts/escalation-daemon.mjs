import fs from "node:fs";
import path from "node:path";
import { listCases, loadCase, saveCase, transitionTo, STATUS } from "../src/escalation/escalation-case.mjs";
import { dueActions, businessHoursElapsed } from "../src/escalation/followup-scheduler.mjs";
import { appendAudit } from "../src/escalation/audit.mjs";
import { dispatchEmail, dispatchSmsWhatsApp, generatePdfDossier } from "../src/escalation/comms.mjs";
import { followUpEmail, escalationLetterSections } from "../src/escalation/templates.mjs";
import { isSmtpConfigured, missingSmtpHint } from "../src/escalation/email-sender.mjs";
import { updateConnectivityState, degradedMode, offlineForMs } from "../src/escalation/connectivity.mjs";
import { enqueueEmail, flushQueue, queueReport } from "../src/escalation/outbox-queue.mjs";

const STATE_FILE = () => path.resolve(process.cwd(), "data", "escalation", "state", "daemon.json");

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

function loadDaemonState() {
	try {
		return JSON.parse(fs.readFileSync(STATE_FILE(), "utf8"));
	} catch {
		return { runs: 0, lastRunAt: null, lastConnectivity: null, degradedRuns: 0 };
	}
}

function saveDaemonState(state) {
	fs.mkdirSync(path.dirname(STATE_FILE()), { recursive: true });
	fs.writeFileSync(STATE_FILE(), JSON.stringify(state, null, 2), "utf8");
}

async function dispatchFollowUp({ caseData, action, live, online }) {
	const email = followUpEmail({ caseData, stage: action.step });
	const cc = action.step === "FOLLOW_UP_2" ? "reclamation@attijariwafa.com" : undefined;
	const step = `followup-${caseData.followups.length + 1}`;
	const draft = await dispatchEmail({
		caseId: caseData.id,
		to: caseData.complaint.bankContact,
		cc,
		from: "treasury-automation@realworldcerts.com",
		subject: email.subject,
		body: email.body,
		step,
		live: live && online,
	});
	if (live && draft.mode === "draft") {
		enqueueEmail({
			caseId: caseData.id,
			to: caseData.complaint.bankContact,
			cc,
			from: "treasury-automation@realworldcerts.com",
			subject: email.subject,
			body: email.body,
			step,
			draftFile: draft.file,
		});
	}
	return draft;
}

async function handleCase({ caseData, now, live, online }) {
	const eligible = [STATUS.ESCALATED, STATUS.FOLLOW_UP_1, STATUS.FOLLOW_UP_2];
	const summary = { caseId: caseData.id, status: caseData.status, actionsDispatched: 0 };
	if (!eligible.includes(caseData.status)) return summary;

	const hours = businessHoursElapsed(caseData.escrowTimestamp || caseData.dispatchedAt || caseData.updatedAt, now);
	const actions = dueActions({ caseData, now });
	for (const action of actions) {
		const dispatch = await dispatchFollowUp({ caseData, action, live, online });
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
		if (action.step === "FOLLOW_UP_1") transitionTo(caseData, STATUS.FOLLOW_UP_1, { reason: action.reason, actor: "EscalationDaemon" });
		if (action.step === "FOLLOW_UP_2") transitionTo(caseData, STATUS.FOLLOW_UP_2, { reason: action.reason, actor: "EscalationDaemon" });
		if (action.step === "PHONE_ESCALATION") {
			transitionTo(caseData, STATUS.PHONE_ESCALATION, { reason: action.reason, actor: "EscalationDaemon" });
			caseData.hitl = {
				type: "PhoneOperations",
				reason: "Zero response after 3 automated attempts (72 business hours). Direct voice contact with Bank Relationship Manager required.",
				raisedAt: new Date().toISOString(),
			};
		}
		summary.actionsDispatched += 1;
		appendAudit({
			action: live ? "FOLLOW_UP_DISPATCHED_LIVE" : "FOLLOW_UP_DISPATCHED",
			entityId: caseData.id,
			actor: "EscalationDaemon",
			changes: { step: action.step, reason: action.reason, mode: dispatch.mode },
		});
	}
	saveCase(caseData);
	return summary;
}

async function runCycle({ live, now = new Date() }) {
	const connectivity = await updateConnectivityState();
	const degraded = degradedMode();
	const mode = live && connectivity.online ? "live" : "degraded";

	const cases = listCases();
	const handled = [];
	for (const caseData of cases) {
		handled.push(await handleCase({ caseData, now, live, online: connectivity.online === true }));
	}

	let queue = { flushed: 0, sent: 0, failed: 0, remaining: 0 };
	if (mode === "live") {
		queue = await flushQueue();
	} else {
		queue.remaining = queueReport().pending;
	}

	const state = loadDaemonState();
	state.runs += 1;
	state.lastRunAt = new Date().toISOString();
	state.lastConnectivity = connectivity;
	if (mode === "degraded") state.degradedRuns += 1;
	saveDaemonState(state);

	appendAudit({
		action: "DAEMON_CYCLE",
		entityId: "daemon",
		actor: "EscalationDaemon",
		changes: { mode, connectivity: connectivity.status, offlineForMs: offlineForMs(), cases: cases.length, queue },
	});

	return { at: new Date().toISOString(), connectivity, mode, degraded: degraded.degraded, offlineForMs: offlineForMs(), casesHandled: handled, queue };
}

async function main() {
	const args = parseArgs(process.argv);
	const live = Boolean(args.live);
	const once = Boolean(args.once);
	const intervalMs = Number(args["interval-ms"] || process.env.ESCALATION_DAEMON_INTERVAL_MS || "3600000");

	if (live && !isSmtpConfigured()) {
		console.error(`--live requested but ${missingSmtpHint()}`);
		process.exit(1);
	}

	console.log(`EscalationDaemon starting mode=${live ? "live" : "degraded-only"} interval=${intervalMs}ms once=${once}`);
	if (once) {
		const result = await runCycle({ live });
		console.log(JSON.stringify(result, null, 2));
		return;
	}

	const tick = async () => {
		try {
			const result = await runCycle({ live });
			console.log(JSON.stringify(result, null, 2));
		} catch (err) {
			console.error(`Daemon cycle error: ${err.message}`);
		}
	};
	await tick();
	setInterval(tick, intervalMs);
}

main().catch((err) => {
	console.error(err.message);
	process.exit(1);
});
