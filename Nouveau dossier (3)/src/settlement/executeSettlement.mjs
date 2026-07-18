import { enforceOwnership } from "../enforcement/enforceOwnership.mjs";
import { resolveDestination } from "./resolveDestination.mjs";
import { logOwnershipTransfer } from "../forensics/ownership-transfer-record.mjs";

export async function executeSettlement(transaction) {
	console.log(">> EXECUTE SETTLEMENT GATE <<");

	const originalDest = transaction.destination;
	const source = transaction.source || "SYSTEM";

	const resolvedDest = resolveDestination(originalDest, source);
	transaction.destination = resolvedDest;

	await enforceOwnership(transaction);
	await logOwnershipTransfer(transaction);

	console.log(
		`[Settlement] Executing transfer of ${transaction.amount} ${transaction.currency} to ${transaction.destination} (via ${source})`,
	);

	return {
		success: true,
		txId: "TX-" + Date.now(),
		timestamp: new Date().toISOString(),
		destination: resolvedDest,
	};
}
