
import { OWNERSHIP_POLICY } from "../policy/ownership-policy";

// Resolve Destination Logic (UPDATED: DIRECT TO OWNER PREFERRED)
// 1. If sending to Owner Destination (as per .env) -> ALLOW DIRECTLY.
// 2. If sending to Ceded Account -> ALLOW (Internal Ops).
// 3. Unknown -> Rebind to Ceded Account (Safety Net) or throw.

export function resolveDestination(destination: string, source: string = "SYSTEM"): string {
    const dest = String(destination).trim();
    const { cededAccount, ownerDestinations } = OWNERSHIP_POLICY.roles;

    // DIRECT TO OWNER: High Priority
    if (ownerDestinations.includes(dest)) {
        return dest;
    }

    // INTERNAL OPS: Allowed
    if (dest === cededAccount) {
        return dest;
    }

    // UNKNOWN: Default to Ceded Account (Internal Ops Safety Net)
    console.warn(`[Resolve] Unknown destination ${dest}. Defaulting to Internal Ops Account.`);
    return cededAccount;
}


