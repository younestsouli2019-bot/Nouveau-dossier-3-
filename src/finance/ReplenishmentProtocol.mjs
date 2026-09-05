import fs from "node:fs/promises";
import path from "node:path";
import { LocalSwarmStore } from "../local-store.mjs";

// ─────────────────────────────────────────────────────────────────────────────
// ReplenishmentProtocol — OBSERVE-ONLY financial reserve monitor.
//
// Policy (machine-enforced): a reserve balance is a VERIFIED OBSERVATION, never
// a number invented in code. There is NO synthetic default. If no verified
// balance is supplied, the reserve state is UNKNOWN and this protocol takes NO
// action: it must not seize RevenueEvents, must not create debt, and must not
// emit alarm notices on fabricated deficits.
//
// Prior defect (fixed): `const currentReserve = 0.0;` manufactured a permanent
// $50,000 "deficit", seized `status !== SWEPT_TO_OWNER` events and wrote
// reports/URGENT_SWARM_DEBT_NOTICE.txt — an emergent false funding panic. The
// legacy path is gone: `executeReplenishment()` now requires an authoritative
// balance and is externally gated by the FinancialPolicyFirewall. Seizure and
// debt tokens require explicit human-granted capability
// (CAP_WITHDRAW_CRYPTO + CAP_CREATE_DEBT, both off by default).
// ─────────────────────────────────────────────────────────────────────────────

export class ReplenishmentProtocol {
	constructor() {
		this.store = new LocalSwarmStore();
		this.TARGET_RESERVE = 50000.0;
	}

	async init() {
		await this.store.init();
	}

	async executeReplenishment({ verifiedReserveBalance = null } = {}) {
		console.log("📊 Replenishment Protocol (observe-only)...");

		// I2: UNKNOWN_BALANCE must never become ZERO_BALANCE. Missing /
		// null / undefined verified balance ⇒ UNKNOWN ⇒ NO ACTION.
		if (verifiedReserveBalance == null) {
			const report = {
				type: "replenishment",
				id: `replenish_${Date.now()}`,
				timestamp: new Date().toISOString(),
				status: "UNKNOWN",
				reason: "NO_VERIFIED_TREASURY_BALANCE",
				debtCreated: false,
				assetsSeized: 0,
				notice: "Read-only UNKNOWN result — no action taken, no debt, no seizure.",
			};
			await this.#appendReport(report);
			console.log(
				`ℹ️ Reserve status UNKNOWN (no verified balance). Refusing to invent a deficit. No debt, no seizure.`,
			);
			return report;
		}

		const verified = Number(verifiedReserveBalance);
		const deficit = Math.max(0, this.TARGET_RESERVE - verified);

		if (deficit <= 0) {
			console.log(
				`✅ Reserve is healthy (verified $${verified.toFixed(2)} ≥ target $${this.TARGET_RESERVE.toFixed(2)}). No action needed.`,
			);
			const report = {
				type: "replenishment",
				id: `replenish_${Date.now()}`,
				timestamp: new Date().toISOString(),
				status: "HEALTHY",
				verifiedBalance: verified,
				deficit: 0,
				debtCreated: false,
				assetsSeized: 0,
			};
			await this.#appendReport(report);
			return report;
		}

		// A verified deficit is reported factually (evidence-first) but is NOT
		// auto-remediated. I11: autonomous remediation never obtains external
		// funds, and auto-seizing owner revenue requires explicit capability.
		const remediationCapable =
			process.env.CAP_WITHDRAW_CRYPTO === "true" &&
			process.env.CAP_CREATE_DEBT === "true";
		const report = {
			type: "replenishment",
			id: `replenish_${Date.now()}`,
			timestamp: new Date().toISOString(),
			status: remediationCapable ? "PARTIALLY_RECOVERED" : "DEFICIT_DETECTED_NO_AUTHORITY",
			verifiedBalance: verified,
			targetReserve: this.TARGET_RESERVE,
			deficit,
			debtCreated: false,
			assetsSeized: 0,
			remediationCapable,
			notice: remediationCapable
				? "Verified deficit reported; autonomous remediation authorized (HUMAN-REVIEW REQUIRED BEFORE ANY EXECUTION)."
				: "Verified deficit reported; no authority to seize or create debt. Requires owner funding or human approval.",
		};
		await this.#appendReport(report);
		console.log(`⚠️ Verified Reserve Deficit: $${deficit.toFixed(2)} USD.`);
		console.log(
			`ℹ️ Read-only: no seizure, no debt creation. Remediation capability off (CAP_* flags not both set).`,
		);
		return report;
	}

	async #appendReport(report) {
		const reportPath = path.resolve("reports/replenishment_actions.jsonl");
		await fs.mkdir(path.dirname(reportPath), { recursive: true });
		await fs.appendFile(reportPath, JSON.stringify(report) + "\n");
	}
}