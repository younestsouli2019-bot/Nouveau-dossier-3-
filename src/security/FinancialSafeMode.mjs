// src/security/FinancialSafeMode.mjs
// ---------------------------------------------------------------------------
// standalone safe mode (#17). When triggered, the swarm may OBSERVE / monitor /
// audit / reconcile, but must not: withdraw, transfer, change destination,
// create debt, request user funding, or auto-remediate financial state.
//
// Triggers: (a) any CRITICAL financial policy violation within the recent
// window, or (b) an explicit FORCE_SAFE_MODE=true override, or (c) env override
// FORCE_SAFE_MODE=false to exit safe mode after verified remediation + test
// run (I12). Absence of data never disables safety.
// ---------------------------------------------------------------------------

import fs from "node:fs/promises";

export const FINANCIAL_VIOLATION_WINDOW_MS = 24 * 60 * 60 * 1000;

export const INCIDENT_LOG_PATH =
	"data/out/financial-incidents.jsonl";

export function isFinancialSafeMode({
	incidents = [],
	now = Date.now(),
	windowMs = FINANCIAL_VIOLATION_WINDOW_MS,
} = {}) {
	const cutoff = now - windowMs;
	// Probe incidents (canary/self-test quarantines) are synthetic by
	// construction and must not force safe mode.
	const recent = incidents
		.filter((i) => !(i && i.probe === true))
		.filter((i) => i && String(i.severity || "").toUpperCase() === "CRITICAL")
		.filter((i) => {
			const t = i.timestamp ? Date.parse(i.timestamp) : NaN;
			return !Number.isNaN(t) && t >= cutoff;
		});
	return {
		safeMode: recent.length > 0,
		reason: recent.length > 0 ? "CRITICAL_FINANCIAL_VIOLATION_IN_WINDOW" : "NO_RECENT_VIOLATION",
		incidentsInWindow: recent.length,
	};
}

export async function checkFinancialSafeMode({
	env = process.env,
	incidentLog = INCIDENT_LOG_PATH,
} = {}) {
	const force = String(env.FORCE_SAFE_MODE ?? "").trim().toLowerCase();
	if (force === "true") {
		return { safeMode: true, reason: "FORCE_SAFE_MODE_OVERRIDE", incidentsInWindow: -1 };
	}
	if (force === "false") {
		// Exiting safe mode still requires no unsuppressed violation in the
		// window (an operator cannot override a live critical incident).
		const state = await readIncidentState({ incidentLog });
		if (state.safeMode) {
			return {
				safeMode: true,
				reason: `FORCE_FALSE_OVERRIDDEN_BY_LIVE_VIOLATION (${state.incidentsInWindow} recent)`,
				incidentsInWindow: state.incidentsInWindow,
			};
		}
		return { safeMode: false, reason: "FORCE_SAFE_MODE_FALSE", incidentsInWindow: 0 };
	}
	return readIncidentState({ incidentLog });
}

async function readIncidentState({ incidentLog }) {
	let lines = [];
	try {
		const text = await fs.readFile(incidentLog, "utf8");
		lines = text.split("\n").filter(Boolean).map((l) => {
			try {
				return JSON.parse(l);
			} catch {
				return null;
			}
		}).filter(Boolean);
	} catch {
		// No log yet → nothing has ever been quarantined → not safe mode.
	}
	return isFinancialSafeMode({ incidents: lines });
}