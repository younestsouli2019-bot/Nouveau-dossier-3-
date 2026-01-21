
import { enforceOwnership } from "../enforcement/enforceOwnership";
import { resolveDestination } from "./resolveDestination";
import { logOwnershipTransfer } from "../forensics/ownership-transfer-record";

// Settlement Gate

export async function executeSettlement(transaction: any) {
    console.log(">> EXECUTE SETTLEMENT GATE <<");

    // 1. Resolve Destination (Direct to Owner)
    // We pass source but it's less critical now since Direct Flow is allowed
    const originalDest = transaction.destination;
    const source = transaction.source || "SYSTEM";
    
    const resolvedDest = resolveDestination(originalDest, source);
    transaction.destination = resolvedDest; // Mutate transaction to canonical destination

    // 2. Enforce Ownership (Freeze if fail)
    // Checks that the destination is either Owner or Allowed Ops
    await enforceOwnership(transaction);

    // 3. Log Forensics
    await logOwnershipTransfer(transaction);

    // 4. Proceed (Simulation of execution)
    console.log(`[Settlement] Executing transfer of ${transaction.amount} ${transaction.currency} to ${transaction.destination} (via ${source})`);
    
    return {
        success: true,
        txId: "TX-" + Date.now(),
        timestamp: new Date().toISOString(),
        destination: resolvedDest
    };
}


