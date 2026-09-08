import ccxt from "ccxt";
import "dotenv/config";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { parseArgs } from "../src/utils/cli.mjs";
import { assertCapability, CAPABILITIES } from "../src/finance/capabilities.mjs";
import { createHash } from "crypto";

// ============================================================================
// Fail-closed Bitget settlement instruction generator + (gated) live executor.
//
// RULES (permanent-solution directive, settlement-gap P0/P1, 2026-09-07):
//   - This file must NEVER auto-execute on import. It only runs when invoked
//     directly as a CLI (import.meta.url gate below).
//   - Generating an instruction file is NOT settlement. Instructions carry
//     settled:false until provider confirmation + reconciliation.
//   - Live execution is fail-closed: requires BOTH explicit --execute AND the
//     WITHDRAW_CRYPTO capability (I8) AND SWARM_LIVE === true. Without all
//     three, the script produces a WAITING_MANUAL_EXECUTION instruction only.
//   - No hardcoded destination wallets/emails. The recipient must be provided
//     via --address (or env) or the run aborts.
// ============================================================================

const LOGS_DIR = path.resolve("logs");
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
const logFile = path.join(LOGS_DIR, "bitget-settlement.log");

function log(message) {
	const timestamp = new Date().toISOString();
	const line = `[${timestamp}] ${message}\n`;
	console.log(line.trim());
	fs.appendFileSync(logFile, line);
}

function getArgs() {
	const args = parseArgs(process.argv);
	return {
		coin: String(args.coin || "USDT").toUpperCase(),
		network: String(args.network || "BEP20").toUpperCase(),
		address: String(args.address || process.env.BITGET_TARGET_ADDRESS || "").trim(),
		amount: args.amount ? Number(args.amount) : null,
		execute: args.execute === true,
	};
}

function destFingerprint(raw) {
	return createHash("sha256").update(raw).digest("hex");
}

function writeInstructionFile({ coin, network, address, amount }) {
	const outDir = path.resolve("settlements/crypto");
	if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
	const filePath = path.join(outDir, `bitget_instruction_${Date.now()}.json`);
	const payload = {
		provider: "bitget",
		action: "withdraw",
		coin,
		network,
		destinationFingerprint: destFingerprint(address),
		amount,
		// INSTRUCTION != SETTLEMENT — this file proves nothing was paid out.
		settled: false,
		status: "WAITING_MANUAL_EXECUTION",
		creds_present: !!(
			process.env.BITGET_API_KEY &&
			process.env.BITGET_API_SECRET &&
			process.env.BITGET_PASSPHRASE
		),
		live_gate: {
			swarm_live: String(process.env.SWARM_LIVE || "false").toLowerCase() === "true",
			capability_granted: assertCapability(CAPABILITIES.WITHDRAW_CRYPTO).ok,
		},
		origin: "in_house",
	};
	fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
	return filePath;
}

async function executeBitgetWithdrawal() {
	const args = getArgs();
	log("--- Bitget Settlement (fail-closed) ---");

	if (!args.address) {
		throw new Error(
			"No recipient address. Provide --address or set BITGET_TARGET_ADDRESS — hardcoded destinations are forbidden.",
		);
	}
	if (!args.amount || !(args.amount > 0)) {
		throw new Error("No positive amount. Provide --amount (a default amount is never implied).");
	}

	const capability = assertCapability(CAPABILITIES.WITHDRAW_CRYPTO);
	const swarmLive = String(process.env.SWARM_LIVE || "false").toLowerCase() === "true";

	// Default path: instruction only. This is honest and settles nothing.
	if (!args.execute || !capability.ok || !swarmLive) {
		const filePath = writeInstructionFile(args);
		log(`Instruction queued (settled:false): ${filePath}`);
		log(`  execute=${args.execute} capability=${capability.ok} swarm_live=${swarmLive}`);
		return {
			instruction_generated: true,
			settled: false,
			instruction_file: filePath,
			gates: { execute: args.execute, capability: capability.ok, swarmLive },
		};
	}

	// Live path — only reachable with --execute AND capability AND SWARM_LIVE.
	const apiKey = process.env.BITGET_API_KEY;
	const secret = process.env.BITGET_API_SECRET;
	const password = process.env.BITGET_PASSPHRASE;
	if (!apiKey || !secret || !password) {
		throw new Error("CRITICAL: Missing Bitget API credentials. Refusing live execution.");
	}

	const bitget = new ccxt.bitget({
		apiKey,
		secret,
		password,
		enableRateLimit: true,
	});

	try {
		log("Syncing time with Bitget server...");
		await bitget.loadTimeDifference();
		const balances = await bitget.fetchBalance();
		const available = balances.free[args.coin];
		log(`Available ${args.coin} balance: ${available}`);
		if (!available || available < args.amount) {
			throw new Error(
				`Insufficient ${args.coin} balance (${available}) for ${args.amount} ${args.coin}.`,
			);
		}

		log(
			`Attempting to withdraw ${args.amount} ${args.coin} to ${args.address} on ${args.network}...`,
		);
		const withdrawal = await bitget.withdraw(args.coin, args.amount, args.address, undefined, {
			network: args.network,
		});
		log(`Withdrawal request accepted. Transaction ID: ${withdrawal.id}`);

		// Provider request is accepted — but WITHOUT provider confirmation the
		// payout is PROCESSING/UNKNOWN, not settled. Reconciliation required.
		writeInstructionFile(args);
		return {
			instruction_generated: true,
			settled: false,
			provider_request_id: withdrawal.id,
			providerTransactionId: withdrawal.id ?? null,
			reconciliation_required: true,
			amount: args.amount,
			coin: args.coin,
		};
	} catch (error) {
		const err = new Error(`Bitget settlement failed: ${error.message}`);
		log(err.message);
		writeInstructionFile(args);
		throw err;
	}
}

// CLI-only execution guard: never auto-run on import.
const isDirect = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirect) {
	executeBitgetWithdrawal()
		.then((result) => {
			process.stdout.write(JSON.stringify(result, null, 2) + "\n");
			process.exit(0);
		})
		.catch((error) => {
			log(`Fatal: ${error.message}`);
			process.exit(1);
		});
}