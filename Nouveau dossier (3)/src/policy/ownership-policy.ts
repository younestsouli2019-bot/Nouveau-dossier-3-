// Policy Source of Truth
// Restored from User Specification

export const OWNERSHIP_POLICY = {
	version: "1.2.0",
	status: "ACTIVE",
	roles: {
		cededAccount: "230780211161400002318873", // Internal Ops / Ledger Identity
		ownerDestinations: [
			// DIRECT PAYOUT TARGETS defined in .env
			"younestsouli2019@gmail.com",
			"007810000448500030594182",
		],
	},
	directives: [
		"DIRECT_TO_OWNER_ACCOUNTS", // Primary Directive
		"NO_INTERMEDIARIES",
		"ALLOW_INTERNAL_OPS_TO_CEDED",
	],
};

export function validateFlow(source: string, destination: string): boolean {
	const dest = String(destination).trim();
	const { cededAccount, ownerDestinations } = OWNERSHIP_POLICY.roles;

	// DIRECT TO OWNER: Always allowed from any source (Swarm or Internal)
	if (ownerDestinations.includes(dest)) {
		return true;
	}

	// INTERNAL OPS: Allowed if explicitly targeting the Ceded Account
	if (dest === cededAccount) {
		return true;
	}

	// Violation: Destination is neither an Owner Account nor the Ceded Account
	return false;
}
