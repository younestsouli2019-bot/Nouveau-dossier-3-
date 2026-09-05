import fs from "node:fs/promises";
import path from "node:path";
import { PaymentAssuranceProtocol } from "../finance/PaymentAssuranceProtocol.mjs";
import { FinancialGuardian } from "./FinancialGuardian.mjs";

export class MissionOrchestrator {
	constructor(config = {}) {
		this.config = config;
		this.ledgerPath = path.resolve("data/swarm/mission-ledger.json");
		this.assurance = new PaymentAssuranceProtocol();
		this.guardian = config.guardian || new FinancialGuardian(config.guardianOptions);
	}

	async loadLedger() {
		try {
			const data = await fs.readFile(this.ledgerPath, "utf8");
			return JSON.parse(data);
		} catch {
			return { missions: [] };
		}
	}

	async saveLedger(ledger) {
		await fs.mkdir(path.dirname(this.ledgerPath), { recursive: true });
		await fs.writeFile(this.ledgerPath, JSON.stringify(ledger, null, 2));
	}

	async planMission(proposal) {
		// Convert a proposal into an actionable plan
		// This is where the "reasoning" happens.

		const plan = {
			missionId: `mission_${proposal.id}`,
			proposalId: proposal.id,
			status: "planned",
			payer_email: proposal.payer_email || null, // Capture Payer Context
			created_at: new Date().toISOString(),
			tasks: [],
		};

		if (proposal.type === "VELOCITY_OPPORTUNITY") {
			plan.tasks = [
				{ id: "t1", action: "verify_revenue_stability", status: "pending" },
				{ id: "t2", action: "simulate_batch_impact", status: "pending" },
				{ id: "t3", action: "notify_owner_optimization", status: "pending" },
			];
		} else {
			// Default plan for unknown types
			plan.tasks = [{ id: "t1", action: "log_proposal", status: "pending" }];
		}

		return plan;
	}

	async executeMission(mission) {
		console.log(`🚀 Orchestrator executing mission: ${mission.missionId}`);
		mission.status = "in_progress";

		// --- PAYMENT ASSURANCE GATE ---
		if (mission.payer_email) {
			await this.assurance.init();
			const assurance = await this.assurance.verifyMissionAssurance(
				mission.missionId,
				mission.payer_email,
			);
			if (!assurance.ok) {
				console.warn(
					`[Orchestrator] 🛑 STOP WORK ORDER: Mission ${mission.missionId} blocked. Reason: ${assurance.reason}`,
				);
				mission.status = "blocked_payment_assurance";
				mission.block_reason = assurance.reason;
				return mission;
			}
		}
		// ------------------------------

		// Execute tasks sequentially
		for (const task of mission.tasks) {
			if (task.status === "pending") {
				try {
					console.log(`   - Task: ${task.action}...`);
					// Simulate execution time
					await new Promise((r) => setTimeout(r, 100));
					task.status = "completed";
					task.completed_at = new Date().toISOString();
				} catch (e) {
					task.status = "failed";
					task.error = e.message;
					mission.status = "failed";
					break;
				}
			}
		}

		if (mission.status !== "failed") {
			mission.status = "completed";
			mission.completed_at = new Date().toISOString();
			console.log(`✅ Mission ${mission.missionId} COMPLETED`);
		} else {
			console.log(`❌ Mission ${mission.missionId} FAILED`);
		}

		return mission;
	}

	async processProposals(proposals) {
		const ledger = await this.loadLedger();
		const results = [];

		for (const proposal of proposals) {
			// check if already processed
			if (ledger.missions.find((m) => m.proposalId === proposal.id)) {
				continue;
			}

			// ── FINANCIAL POLICY GATE (I3): a proposal may not carry funding
			// prerequisites into a receive/revenue flow. Blocked proposals are
			// recorded and quarantined — never planned nor executed.
			const scan = await this.guardian.scan(proposal);
			if (scan.blocked) {
				const incident = await this.guardian.quarantineAgent({
					agentId: proposal.agentId || proposal.sourceAgent || "unknown",
					proposal,
					trigger: scan,
					probe: proposal.probe === true,
				});
				const blocked = {
					missionId: `mission_blocked_${proposal.id}`,
					proposalId: proposal.id,
					status: "blocked_financial_policy",
					block_reason: scan.detail,
					severity: scan.severity,
					safe_mode: true,
					incidentId: incident.id,
					created_at: new Date().toISOString(),
					tasks: [],
				};
				ledger.missions.push(blocked);
				results.push(blocked);
				continue;
			}

			const plan = await this.planMission(proposal);
			const executed = await this.executeMission(plan);

			ledger.missions.push(executed);
			results.push(executed);
		}

		if (results.length > 0) {
			// Keep ledger manageable
			if (ledger.missions.length > 200)
				ledger.missions = ledger.missions.slice(-200);
			await this.saveLedger(ledger);
		}

		return results;
	}
}
