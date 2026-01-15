import { OWNERSHIP_POLICY } from "../policy/ownership-policy";

export function resolveDestination(input: { requested: string; ownerDestination: string }) {
  if (OWNERSHIP_POLICY.cededAccounts.includes(input.requested)) {
    return {
      destination: input.ownerDestination,
      reason: "ACCOUNT_OWNERSHIP_TRANSFERRED",
      rewritten: true
    };
  }
  return {
    destination: input.requested,
    rewritten: false
  };
}
