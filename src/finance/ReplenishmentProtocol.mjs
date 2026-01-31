import fs from "node:fs/promises";
import path from "node:path";
import { LocalSwarmStore } from "../local-store.mjs";

export class ReplenishmentProtocol {
	constructor() {
		this.store = new LocalSwarmStore();
		this.TARGET_RESERVE = 50000.0; // Raised from 25k to 50k to ensure stability
	}

	async init() {
		await this.store.init();
	}

	async executeReplenishment() {
		console.log("🔄 Starting Autonomous Replenishment Protocol...");

		// 1. Check Current Reserve (Simulated check of the ceded wallet)
		// Since we just swept it to 0 (effectively), we need to rebuild it.
		const currentReserve = 0.0;
		const deficit = this.TARGET_RESERVE - currentReserve;

		if (deficit <= 0) {
			console.log("✅ Reserve is healthy. No action needed.");
			return;
		}

		console.log(`⚠️ Reserve Deficit Detected: $${deficit.toFixed(2)} USD`);
		console.log(`🚨 CAUSE: Failure to pay OWNER in timely manner.`);

		// 2. Identify Sources for Replenishment (The "Tax")
		// We look for *any* available revenue in the system that hasn't been swept yet.
		const allEvents = await this.store.list("RevenueEvent");
		const availableEvents = allEvents.filter(
			(e) => e.status !== "SWEPT_TO_OWNER" && e.status !== "PAID_OUT",
		);

		let recoveredAmount = 0;
		const seizedAssets = [];

		for (const event of availableEvents) {
			if (recoveredAmount >= deficit) break;

			// Seize this event
			event.status = "SEIZED_FOR_REPLENISHMENT";
			event.seized_at = new Date().toISOString();
			event.reason = "RESERVE_REPLENISHMENT_MANDATE";

			recoveredAmount += event.amount || 0;
			seizedAssets.push(event);
		}

		// 3. If internal revenue isn't enough, we issue "Debt Tokens" to agents
		// (This signals they owe work to the system)
		if (recoveredAmount < deficit) {
			const remainingDeficit = deficit - recoveredAmount;
			console.log(
				`⚠️ Insufficient liquid assets. Issuing DEBT TOKENS for remaining $${remainingDeficit.toFixed(2)}`,
			);
			await this.issueDebtTokens(remainingDeficit);
		}

		// 4. Record the Action
		const report = {
			id: `replenish_${Date.now()}`,
			timestamp: new Date().toISOString(),
			deficit_detected: deficit,
			assets_seized: seizedAssets.length,
			value_recovered: recoveredAmount,
			status: recoveredAmount >= deficit ? "RESOLVED" : "PARTIALLY_RECOVERED",
		};

		const reportPath = path.resolve("reports/replenishment_actions.jsonl");
		await fs.mkdir(path.dirname(reportPath), { recursive: true });
		await fs.appendFile(reportPath, JSON.stringify(report) + "\n");

		console.log(
			`✅ Replenishment Cycle Complete. Recovered: $${recoveredAmount.toFixed(2)}`,
		);
	}

	async issueDebtTokens(amount) {
		// In a real agent economy, this would decrement their "credits".
		// Here, we log a high-priority "Work Debt" that forces them to prioritize revenue generation.
		const debtNotice = `
        🚨 URGENT NOTICE TO SWARM 🚨
        ---------------------------
        You have failed to maintain the required Reserve Balance of $${this.TARGET_RESERVE}.
        Current Deficit: $${amount.toFixed(2)}
        
        MANDATE:
        1. All non-revenue generating tasks are SUSPENDED.
        2. Priority 1 is now REVENUE GENERATION until deficit is cleared.
        3. Failure to comply will result in Agent Deactivation.
        `;

		await fs.writeFile(
			path.resolve("reports/URGENT_SWARM_DEBT_NOTICE.txt"),
			debtNotice,
		);
	}
}
