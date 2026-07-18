// Policy Source of Truth (Active JS Implementation)
// Synced from src/policy/ownership-policy.ts

export const OWNERSHIP_POLICY = {
	version: "1.2.0",
	status: "ACTIVE",
	roles: {
		cededAccount: "230780211161400002318873",
		ownerDestinations: [
			"younestsouli2019@gmail.com",
			"007810000448500030594182",
		],
	},
	directives: [
		"DIRECT_TO_OWNER_ACCOUNTS",
		"NO_INTERMEDIARIES",
		"ALLOW_INTERNAL_OPS_TO_CEDED",
	],
};

export function validateFlow(source, destination) {
	const dest = String(destination).trim();
	const { cededAccount, ownerDestinations } = OWNERSHIP_POLICY.roles;

	// DIRECT TO OWNER: Always allowed
	if (ownerDestinations.includes(dest)) {
		return true;
	}

	// INTERNAL OPS: Allowed
	if (dest === cededAccount) {
		return true;
	}

	// Violation
	return false;
}
