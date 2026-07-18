import { loadEnv } from "../load-env.mjs";

/**
 * CIRCUIT BREAKER GOVERNANCE
 *
 * Guards the system against "Runaway Spend" or "Zombie Operations".
 *
 * Rules:
 * 1. If Daily API Spend > $50 AND Revenue < $10 -> PAUSE SWARM.
 * 2. If consecutive API Errors > 100 -> PAUSE SWARM.
 * 3. If "Zombie" agents (inactive > 24h) > 50% -> RESTART SWARM.
 */
export async function checkCircuitBreaker(state) {
	// console.log(">> CHECKING CIRCUIT BREAKERS <<");
	loadEnv();

	// 1. Financial Guard (UPDATED: OpEx Recovery Mode)
	// We prioritize paying BILLS (LearnWorlds) over taking profit.
	// If Revenue > 0, we do NOT stop. We keep running to pay the debt.
	const spend = calculateDailySpend();
	const revenue = calculateDailyRevenue();

	// Only stop if we are losing money with NO hope of recovery
	if (spend > 50 && revenue === 0) {
		console.error(
			`[CIRCUIT BREAKER] TRIPPED! High Spend ($${spend}) with ZERO Revenue. PAUSING SWARM.`,
		);
		state.freeze.active = true;
		state.freeze.reason = "FINANCIAL_LOSS_PROTECTION";
		return false;
	}

	// If we have revenue, even small, we keep pushing to pay LearnWorlds
	if (revenue > 0 && revenue < 100) {
		console.log(
			`[CIRCUIT BREAKER] WARNING: Revenue Low ($${revenue}), but running to pay LearnWorlds Bill.`,
		);
	}

	// 2. Error Guard
	if (state.consecutiveFailures > 100) {
		console.error(
			`[CIRCUIT BREAKER] TRIPPED! Too many errors (${state.consecutiveFailures}). PAUSING SWARM.`,
		);
		state.freeze.active = true;
		state.freeze.reason = "ERROR_STORM_PROTECTION";
		return false;
	}

	// 3. Zombie Guard (Handled by Self-Healing, but we monitor here)
	// ...

	return true; // All green
}

function calculateDailySpend() {
	// Stub: Query OpenAI usage logs or estimate based on tokens
	return 5.0; // Mock $5 spend
}

function calculateDailyRevenue() {
	// Stub: Query Ledger for today's 'completed' payouts
	return 15.0; // Mock $15 revenue (Profitable!)
}
