import { OWNERSHIP_POLICY, validateFlow } from "../policy/ownership-policy.mjs";
import { freezeSystem } from "./freezeSystem.mjs";

export async function enforceOwnership(transaction) {
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

	return true;
}
