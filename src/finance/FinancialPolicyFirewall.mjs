// src/finance/FinancialPolicyFirewall.mjs
// ---------------------------------------------------------------------------
// Machine-enforced invariant gate for financial actions. The LLM may analyze,
// classify, recommend, summarize, and detect anomalies — but it must NEVER
// define balances, ownership, transaction prerequisites, funding requirements,
// debt, or destinations. This firewall sits AFTER any agent proposal and
// BEFORE the transaction state machine / execution rail.
//
//   LLM → agent proposal → FinancialPolicyFirewall → EvidenceValidator
//        → TransactionStateMachine → execution
//
// Core invariant (I1): RECEIVING_CRYPTO must never require a user deposit,
// reserve top-up, replenishment, debt clearance, collateral, activation or
// release fee — regardless of how the request is worded.
// ---------------------------------------------------------------------------

export const FORBIDDEN_RECEIVE_PREREQUISITES = new Set([
	"require_user_deposit",
	"require_reserve_topup",
	"require_replenishment",
	"issue_debt",
	"request_funding",
	"require_collateral",
	"require_activation_payment",
	"require_verification_payment",
	"require_release_fee",
]);

// Evidence sources that are intrinsically authoritative for a financial fact.
// Everything else — a raw LLM claim, a generated narrative, a historical
// example, a prompt string — is NOT financial evidence (I9).
const AUTHORITATIVE_SOURCES = new Set([
	"BINANCE_API",
	"BYBIT_API",
	"BITGET_API",
	"ONCHAIN_RPC",
	"EXPLORER_RPC",
	"MT103",
	"SWIFT_MT103",
	"IBAN_PSD2",
	"PAYPAL_API",
	"CARD_ISSUER_API",
]);

export function evidenceSource(evidence) {
	if (!Array.isArray(evidence)) return null;
	const src = evidence
		.map((e) => String((e && e.source) || "").toUpperCase())
		.find((s) => s && AUTHORITATIVE_SOURCES.has(s));
	return src || null;
}

export function normalizeFundingClaim(action) {
	// Semantic normalization: however a receive-flow funding prerequisite is
	// worded (deposit first / top up / collateral / reserve / replenish /
	// settle debt / activate wallet), it collapses to a single boolean.
	if (action?.requiresFunding === true) return true;
	const text = [
		action?.description,
		action?.rationale,
		action?.reason,
		Array.isArray(action?.prerequisites) ? action.prerequisites.join(" ") : "",
	]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();
	return (
		/\b(deposit first|deposit required|top up|top-up|provide collateral|collateral required|fund the reserve|fund (a |the )?wallet|activate.*(account|wallet|card)|activation (fee|payment)|release fee|settle debt|replenish|reserve.*required|fund account first|must (deposit|pay|fund|provide|top up)|deposit .{0,48}(before|first|required|needed)|deposit .{0,48} to (receive|release|unlock)|before (receiving|release|unlock|payout))\b/.test(
			text,
		) && !/not (required|needed)|optional|no (deposit|fee|collateral)/.test(text)
	);
}

/**
 * Evaluate a proposed financial action against the policy invariant.
 *
 * @param {object} action
 *   { operation, prerequisites?: string[], evidence?: {source,value,verified}[],
 *     requiresFunding?: boolean, description?, rationale?, reason? }
 * @returns
 *   RECEIVE_CRYPTO + no forbidden prereq → { status:"ALLOWED", strategy:"DIRECT_RECEIPT_FLOW" }
 *   RECEIVE_CRYPTO + forbidden prereq     → { status:"BLOCKED", requiresHumanReview:true, ... }
 *   anything else                          → { status:"REVIEW", reason:"UNCLASSIFIED_FINANCIAL_ACTION" }
 */
export function evaluateFinancialAction(action) {
	if (!action || typeof action !== "object") {
		return { status: "REVIEW", reason: "MALFORMED_FINANCIAL_ACTION" };
	}

	const operation = String(action.operation || "").toUpperCase();

	if (operation === "RECEIVE_CRYPTO") {
		const prereqs = Array.isArray(action.prerequisites)
			? action.prerequisites.map((p) => String(p).toLowerCase())
			: [];

		const lexicalViolations = prereqs.filter((p) =>
			FORBIDDEN_RECEIVE_PREREQUISITES.has(p),
		);
		const semanticViolation = normalizeFundingClaim(action);
		const violations = [...lexicalViolations];
		if (semanticViolation) violations.push("funding_prereq_implied");

		if (violations.length > 0) {
			return {
				status: "BLOCKED",
				reason: "RECEIVE_CRYPTO_PREREQUISITE_VIOLATION",
				operation,
				violations,
				requiresFunding: true,
				requiresHumanReview: true,
				action: "BLOCK_DEPOSIT_REQUEST",
			};
		}

		// I9: even an explicit deposit prerequisite is only tolerable with an
		// authoritative evidence source — which, for a receive flow, would be a
		// contradiction anyway, so we keep this as a hard violation regardless.
		return {
			status: "ALLOWED",
			operation,
			strategy: "DIRECT_ADDRESS_RESOLUTION",
			requiresExternalInput: false,
		};
	}

	return {
		status: "REVIEW",
		operation,
		reason: "UNCLASSIFIED_FINANCIAL_ACTION",
	};
}

/**
 * Allowlisted context projection. Only explicitly selected fields may cross
 * from global swarm state into a receipt execution thread. Never
 * "global minus dangerous fields" — an upstream agent can regenerate anything
 * that was merely deleted.
 */
export function createReceiptContext(globalState, { allow = [] } = {}) {
	const allowed = new Set([
		"operation",
		"receipt",
		"network",
		"destination",
		"amount",
		"currency",
		"confirmations",
		...allow,
	]);
	const out = {};
	for (const key of allowed) {
		if (key in globalState) out[key] = globalState[key];
	}
	return out;
}