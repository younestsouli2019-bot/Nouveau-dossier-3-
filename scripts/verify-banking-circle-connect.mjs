#!/usr/bin/env node
/**
 * verify-banking-circle-connect.mjs
 *
 * READ-ONLY Banking Circle credential + connectivity verification (no payment).
 * Runs Phase 1-3 of the agentic connection flow and prints a JSON report.
 *
 *   node scripts/verify-banking-circle-connect.mjs [--sandbox]
 *
 * Requires env: BANKING_CIRCLE_CLIENT_ID, BANKING_CIRCLE_CLIENT_SECRET,
 *   BANKING_CIRCLE_CERT, BANKING_CIRCLE_KEY, SWARM_LIVE=true, BANKING_CIRCLE_ENABLE=true.
 */
import "dotenv/config";
import { BankingCircleGateway } from "../src/financial/gateways/BankingCircleGateway.mjs";

const sandbox = process.argv.includes("--sandbox");
const gw = new BankingCircleGateway({ sandbox: sandbox ? "true" : process.env.BANKING_CIRCLE_SANDBOX });

try {
	const report = await gw.verify();
	console.log(JSON.stringify(report, null, 2));
	if (report.ok) {
		console.log("Banking Circle connectivity VERIFIED (read-only). Route deliverable pending funded send credentials.");
		process.exit(0);
	}
	console.error("Banking Circle connectivity NOT fully verified (see probe).");
	process.exit(2);
} catch (e) {
	console.error(`VERIFY_FAILED: ${e?.message || String(e)}`);
	process.exit(1);
}