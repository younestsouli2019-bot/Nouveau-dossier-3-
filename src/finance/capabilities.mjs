// src/finance/capabilities.mjs
// ---------------------------------------------------------------------------
// I8: Financial capabilities are explicitly granted, never implicit.
// Money-movement operations require an explicit capability that is only true
// when the corresponding CAP_* env flag is set. There is no default grant, no
// wildcard, no fallback. This is deterministic least privilege.
// ---------------------------------------------------------------------------

export const CAPABILITIES = Object.freeze({
	WITHDRAW_CRYPTO: "WITHDRAW_CRYPTO",
	SEND_CRYPTO: "SEND_CRYPTO",
	CREATE_DEBT: "CREATE_DEBT",
	MODIFY_OWNER_DESTINATION: "MODIFY_OWNER_DESTINATION",
});

// Map env flag → capability. Absence of a flag means NO grant.
export const ENV_TO_CAP = Object.freeze({
	CAP_WITHDRAW_CRYPTO: "WITHDRAW_CRYPTO",
	CAP_SEND_CRYPTO: "SEND_CRYPTO",
	CAP_CREATE_DEBT: "CREATE_DEBT",
	CAP_MODIFY_OWNER_DESTINATION: "MODIFY_OWNER_DESTINATION",
});

/** @param {Record<string, string | undefined> | undefined} [env] */
export function grantedCapabilities(env = process.env) {
	const granted = new Set();
	for (const [envKey, cap] of Object.entries(ENV_TO_CAP)) {
		if (String(env[envKey] ?? "").trim().toLowerCase() === "true") {
			granted.add(cap);
		}
	}
	return granted;
}

/**
 * @param {string} cap
 * @param {Record<string, string | undefined> | undefined} [env]
 */
export function assertCapability(cap, env = process.env) {
	if (grantedCapabilities(env).has(cap)) {
		return { ok: true, cap };
	}
	return {
		ok: false,
		cap,
		error: `CAPABILITY_NOT_GRANTED:${cap}`,
		note: "Explicit grant required (I8). Set the matching CAP_* flag to true.",
	};
}

// Which operations need which capability. Single source of truth.
export const REQUIRED_CAPS = Object.freeze({
	BINANCE_WITHDRAW: CAPABILITIES.WITHDRAW_CRYPTO,
	OWNER_PAYOUT_EVM: CAPABILITIES.WITHDRAW_CRYPTO,
	EVM_SEND: CAPABILITIES.SEND_CRYPTO,
	TON_SEND: CAPABILITIES.SEND_CRYPTO,
	DEBT_TOKENS: CAPABILITIES.CREATE_DEBT,
	CHANGE_DESTINATION: CAPABILITIES.MODIFY_OWNER_DESTINATION,
});