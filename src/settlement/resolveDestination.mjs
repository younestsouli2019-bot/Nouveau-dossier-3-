
import { OWNERSHIP_POLICY } from "../policy/ownership-policy.mjs";

export function resolveDestination(destination, source = "SYSTEM") {
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


