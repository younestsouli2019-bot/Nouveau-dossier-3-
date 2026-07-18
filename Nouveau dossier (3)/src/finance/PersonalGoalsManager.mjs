import { loadEnv } from "../load-env.mjs";
import fs from "fs/promises";
import path from "path";

/**
 * PERSONAL GOALS MANAGER
 *
 * Translates "Revenue" into "Life Upgrades".
 * Allocates incoming funds to specific buckets:
 * 1. Essentials/Debt (Burden Removal)
 * 2. Salary (Peace of Mind)
 * 3. Assets (PC, Flat)
 */
export class PersonalGoalsManager {
	constructor() {
		this.configPath = path.resolve(process.cwd(), "docs/PERSONAL_GOALS.json");
		this.statePath = path.resolve(process.cwd(), "data/goals_state.json");
		this.goals = null;
		this.state = null;
	}

	async load() {
		try {
			const txt = await fs.readFile(this.configPath, "utf8");
			this.goals = JSON.parse(txt);
		} catch {
			console.warn("[Goals] No PERSONAL_GOALS.json found. Using defaults.");
			this.goals = { goals: [], salary: { monthly_target: 0 } };
		}

		try {
			const st = await fs.readFile(this.statePath, "utf8");
			this.state = JSON.parse(st);
		} catch {
			this.state = { allocated: {}, history: [] };
		}
	}

	async saveState() {
		await fs.mkdir(path.dirname(this.statePath), { recursive: true });
		await fs.writeFile(this.statePath, JSON.stringify(this.state, null, 2));
	}

	/**
	 * Allocates a new payout amount to the goals.
	 * @param {number} amount - The net amount received (after Swarm Tax)
	 */
	async allocate(amount) {
		await this.load();

		let remaining = amount;
		const allocationReport = [];

		// 1. Salary / Essentials (40%)
		const salaryShare = amount * 0.4;
		this.state.allocated["salary"] =
			(this.state.allocated["salary"] || 0) + salaryShare;
		allocationReport.push({ target: "Monthly Salary", amount: salaryShare });
		remaining -= salaryShare;

		// 2. Debt / Essentials (40%)
		const debtShare = amount * 0.4;
		this.state.allocated["debt"] =
			(this.state.allocated["debt"] || 0) + debtShare;
		allocationReport.push({ target: "Debt Clearance", amount: debtShare });
		remaining -= debtShare;

		// 3. Specific Assets (20% + Remainder)
		// Sort goals by priority
		const activeGoals = this.goals.goals.sort(
			(a, b) => a.priority - b.priority,
		);

		for (const goal of activeGoals) {
			if (remaining <= 0) break;

			const current = this.state.allocated[goal.id] || 0;
			if (current >= goal.target) continue; // Goal met

			const needed = goal.target - current;
			const toAdd = Math.min(remaining, needed);

			this.state.allocated[goal.id] = current + toAdd;
			remaining -= toAdd;
			allocationReport.push({
				target: goal.name,
				amount: toAdd,
				progress: (((current + toAdd) / goal.target) * 100).toFixed(1) + "%",
			});
		}

		// If money is left over, dump into Savings
		if (remaining > 0) {
			this.state.allocated["savings"] =
				(this.state.allocated["savings"] || 0) + remaining;
			allocationReport.push({ target: "General Savings", amount: remaining });
		}

		await this.saveState();
		return allocationReport;
	}

	async getProgressReport() {
		await this.load();
		const report = [];

		// Salary
		const salaryCurrent = this.state.allocated["salary"] || 0;
		const salaryTarget = this.goals.salary.monthly_target;
		report.push(
			`💵 Salary: $${salaryCurrent.toFixed(2)} / $${salaryTarget} (${((salaryCurrent / salaryTarget) * 100).toFixed(1)}%)`,
		);

		// Debts
		const debtCurrent = this.state.allocated["debt"] || 0;
		report.push(`⛓️ Debt Repayment Fund: $${debtCurrent.toFixed(2)}`);

		// Goals
		for (const goal of this.goals.goals) {
			const curr = this.state.allocated[goal.id] || 0;
			const status =
				curr >= goal.target
					? "✅ COMPLETED"
					: `${((curr / goal.target) * 100).toFixed(1)}%`;
			report.push(
				`🎯 ${goal.name}: $${curr.toFixed(2)} / $${goal.target} [${status}]`,
			);
		}

		return report.join("\n");
	}
}

export const goalsManager = new PersonalGoalsManager();
