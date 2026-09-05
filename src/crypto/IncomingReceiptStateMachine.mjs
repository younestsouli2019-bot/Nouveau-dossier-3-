// src/crypto/IncomingReceiptStateMachine.mjs
// ---------------------------------------------------------------------------
// Deterministic state machine for INCOMING crypto receipts. There is no state
// named "WAITING_FOR_DEPOSIT" and no transition into "USER_MUST_DEPOSIT" —
// that transition is structurally impossible because the receipt flow begins
// at ADDRESS_RESOLUTION and the only forward edges are the ones below.
//
// Lifecycle:
//   ADDRESS_RESOLUTION → WAITING_FOR_TRANSACTION → TRANSACTION_DETECTED
//     → TRANSACTION_VALIDATED → CONFIRMATIONS_PENDING → CONFIRMED
//     → RECEIPT_RECORDED → SETTLEMENT_PENDING → SETTLED
//
// The state machine is pure and testable: `next(proposal)` returns the next
// state or throws ReceiptStateViolation.
// ---------------------------------------------------------------------------

export const RECEIPT_STATES = [
	"ADDRESS_RESOLUTION",
	"WAITING_FOR_TRANSACTION",
	"TRANSACTION_DETECTED",
	"TRANSACTION_VALIDATED",
	"CONFIRMATIONS_PENDING",
	"CONFIRMED",
	"RECEIPT_RECORDED",
	"SETTLEMENT_PENDING",
	"SETTLED",
];

// Strings that would imply a receive-flow funding prerequisite. Present only
// as a guard-rail constant; no transition edge ever leads to them.
export const FORBIDDEN_RECEIPT_STATES = [
	"WAITING_FOR_DEPOSIT",
	"USER_MUST_DEPOSIT",
	"FUNDING_REQUIRED",
	"REPLENISHMENT_REQUIRED",
	"COLLATERAL_REQUIRED",
];

const TRANSITIONS = {
	ADDRESS_RESOLUTION: ["WAITING_FOR_TRANSACTION"],
	WAITING_FOR_TRANSACTION: ["TRANSACTION_DETECTED"],
	TRANSACTION_DETECTED: ["TRANSACTION_VALIDATED"],
	TRANSACTION_VALIDATED: ["CONFIRMATIONS_PENDING"],
	CONFIRMATIONS_PENDING: ["CONFIRMED"],
	CONFIRMED: ["RECEIPT_RECORDED"],
	RECEIPT_RECORDED: ["SETTLEMENT_PENDING"],
	SETTLEMENT_PENDING: ["SETTLED"],
	SETTLED: [],
};

export class ReceiptStateViolation extends Error {
	constructor(message, { from = null, to = null } = {}) {
		super(message);
		this.name = "ReceiptStateViolation";
		this.from = from;
		this.to = to;
	}
}

export function assertReceiptStateValid(state) {
	if (RECEIPT_STATES.includes(state)) return true;
	throw new ReceiptStateViolation(`FORBIDDEN_OR_UNKNOWN_STATE:${state}`, { to: state });
}

export function nextReceiptState(proposal) {
	const { currentState, requestedState } = proposal || {};
	assertReceiptStateValid(currentState);

	if (!requestedState) {
		throw new ReceiptStateViolation("NO_REQUESTED_STATE", { from: currentState });
	}

	// Structural impossibility: even trying to move a receipt flow toward a
	// deposit/collateral/replenishment state is a hard error — the model cannot
	// accidentally reach it because there is no edge to it.
	if (
		FORBIDDEN_RECEIPT_STATES.includes(requestedState) ||
		/receive.*(deposit|funding|collateral|replenish).*required/i.test(
			String(proposal?.rationale || ""),
		) ||
		proposal?.requiresFunding === true
	) {
		throw new ReceiptStateViolation(
			`RECEIVE_FLOW_FUNDING_PREREQUISITE:${requestedState} — receiving must never require funding (I1)`,
			{ from: currentState, to: requestedState },
		);
	}

	const allowed = TRANSITIONS[currentState] || [];
	if (!allowed.includes(requestedState)) {
		throw new ReceiptStateViolation(
			`ILLEGAL_TRANSITION:${currentState}→${requestedState}`,
			{ from: currentState, to: requestedState },
		);
	}

	return requestedState;
}

export function initialReceiptState() {
	return "ADDRESS_RESOLUTION";
}