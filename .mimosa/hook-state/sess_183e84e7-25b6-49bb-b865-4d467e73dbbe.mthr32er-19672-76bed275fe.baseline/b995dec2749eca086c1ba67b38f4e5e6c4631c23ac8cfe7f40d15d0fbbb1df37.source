import { OWNERSHIP_POLICY } from "../policy/ownership-policy";
import { freezeSystem } from "../security/freezeSystem";

export class OwnershipViolation extends Error {
	constructor(msg: string) {
		super(msg);
		this.name = "OwnershipViolation";
	}
}

export function enforceOwnership(destination: string) {
	if (OWNERSHIP_POLICY.cededAccounts.includes(destination)) {
		const msg = `OWNERSHIP CEDED: destination ${destination} is no longer valid`;
		if (OWNERSHIP_POLICY.enforcement.freezeOnViolation) {
			freezeSystem(msg);
		}
		throw new OwnershipViolation(msg);
	}
	return true;
}
