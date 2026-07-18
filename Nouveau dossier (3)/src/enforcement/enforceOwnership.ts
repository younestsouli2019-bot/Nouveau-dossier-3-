import { OWNERSHIP_POLICY, validateFlow } from "../policy/ownership-policy";
import { freezeSystem } from "./freezeSystem";

// MoneyMovedGate
export async function enforceOwnership(transaction: any): Promise<boolean> {
	const src = transaction.source || "SYSTEM";
	const dest = transaction.destination || transaction.beneficiary;

	if (!dest) {
		await freezeSystem("Enforcement: No destination specified in transaction.");
		return false;
	}

	if (!validateFlow(src, dest)) {
		await freezeSystem(
			`Enforcement: INVALID FLOW. Destination [${dest}] is NOT a valid Owner Account or Internal Ops Account.`,
		);
		return false;
	}

	// Evidence Integrity Chain check (Stub)
	if (!transaction.evidenceChain || !transaction.evidenceChain.valid) {
		console.warn(
			"Enforcement: Evidence chain missing or invalid (Warning only for now)",
		);
	}

	return true;
}
