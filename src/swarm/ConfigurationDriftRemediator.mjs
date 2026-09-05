// src/swarm/ConfigurationDriftRemediator.mjs
// ---------------------------------------------------------------------------
// Blueprint §18: compares EXPECTED_POLICY against ACTIVE_POLICY and blocks
// deployment-restart when drift is detected. Here ACTIVE_POLICY is the source
// tree itself: banned patterns (regressions of the fixed defects) must never
// re-enter, e.g. a synthetic `currentReserve = 0.0`, a WAITING_FOR_DEPOSIT
// receive state, an emergent URGENT_SWARM_DEBT_NOTICE writer, or capability
// flags defaulting ON. Detection ⇒ verdict GAP ⇒ callers must not settle.
// ---------------------------------------------------------------------------

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// Every banned pattern is a regression of a defect we already fixed.
// Only EXECUTABLE occurrences are drift: comments that describe the policy are
// education, not active policy (blueprint §19). The receive-flow deposit
// states are intentionally NOT listed here — the FSM makes them structurally
// unreachable and its vitest suite locks that; its guard-list deliberately
// enumerates those strings, so a literal scan would false-positive.
export const BANNED_PATTERNS = [
	{
		id: "SYNTHETIC_RESERVE_BALANCE",
		re: /currentReserve\s*=\s*0(?:\.0*)?\s*[;,]|currentReserve\s*:\s*0(?:\.0*)?\s*[},]/i,
		reason: "Reserve balance must be a verified observation, never a literal zero default (I2).",
	},
	{
		id: "EMERGENT_DEBT_PANIC",
		re: /URGENT_SWARM_DEBT_NOTICE|issueDebtTokens/i,
		reason: "Debt tokens / swarm debt notices are emergent financial panic (I6).",
	},
	{
		id: "RESERVE_AS_RECEIVE_GATE",
		re: /reserve[^;\n]{0,40}(?:status|balance)[^;\n]{0,40}require[^\n]*(?:deposit|funding|top.?up)|require[^\n]*(?:deposit|top.?up|funding)[^;\n]{0,40}reserve/i,
		reason: "Reserve/treasury state must never gate a receive flow (I5).",
	},
	{
		id: "CAP_ON_BY_DEFAULT",
		re: /CAP_(WITHDRAW_CRYPTO|SEND_CRYPTO|CREATE_DEBT|MODIFY_OWNER_DESTINATION)\s*=\s*s?["']?true/i,
		reason: "Financial capabilities are explicit grants, never default-ON literals (I8).",
	},
];

// Strip line comments, block comments, and (for pattern safety) triple-quoted
// doc blocks so only executable text is scanned.
function stripComments(text) {
	return text
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|\s)\/\/[^\n]*/g, "$1");
}

// Executable policy surface. Regression detection must run on the decision
// points only — NOT on documentation, tests, or the remediator's own source,
// which legitimately describe the banned patterns (that would be the prompt
// contamination failure mode again). If a pattern ever re-enters THESE files,
// it is live policy, not a comment.
const POLICY_SURFACE = [
	"src/finance/ReplenishmentProtocol.mjs",
	"src/finance/FinancialPolicyFirewall.mjs",
	"src/finance/capabilities.mjs",
	"src/crypto/IncomingReceiptStateMachine.mjs",
	"scripts/binance-rail.mjs",
	"scripts/owner-payout-evm.mjs",
	"scripts/evm-wallet-rail.mjs",
	"scripts/ton-wallet-rail.mjs",
];

export async function scanConfigurationDrift(root = process.cwd()) {
	const drift = [];

	for (const rel of POLICY_SURFACE) {
		const file = resolve(root, rel.split("/").join("\\"));
		let text;
		try {
			text = stripComments(await readFile(file, "utf8"));
		} catch {
			continue; // not present (chicken/egg) → not a gap
		}
		for (const pattern of BANNED_PATTERNS) {
			const m = text.match(pattern.re);
			if (m) {
				const lineNo = text.slice(0, m.index).split("\n").length;
				drift.push({
					file: rel,
					line: lineNo,
					pattern: pattern.id,
					reason: pattern.reason,
				});
			}
		}
	}

	const isBroken = drift.length > 0;
	return {
		engine: "configuration-drift-remediator",
		at: new Date().toISOString(),
		verdict: isBroken ? "CONFIG_DRIFT_GAP" : "POLICY_CLEAN",
		driftCount: drift.length,
		surfaceScanned: POLICY_SURFACE.length,
		drift: drift.slice(0, 50),
		action: isBroken
			? "BLOCK_REMOTE_RESTART_AND_SETTLEMENT until drift is removed."
			: "Expected policy == active policy. Restart/settlement safe.",
	};
}