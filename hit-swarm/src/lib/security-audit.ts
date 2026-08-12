/**
 * Append-only security audit log for the owner-beneficiary guard.
 * Every block (and every non-owner destination refused/deleted) is recorded
 * to data/security/guard-audit.jsonl so enforcement is provable.
 */
import fs from "node:fs";
import path from "node:path";

export interface GuardAuditEntry {
  ts: string;
  kind: "blocked_payout" | "blocked_recipient" | "purged_recipient" | "enforced_ok";
  destination?: string;
  context?: string;
  detail?: string;
}

const AUDIT_DIR = "data/security";

export function appendGuardAudit(entry: GuardAuditEntry): void {
  try {
    fs.mkdirSync(AUDIT_DIR, { recursive: true });
    fs.appendFileSync(
      path.join(AUDIT_DIR, "guard-audit.jsonl"),
      JSON.stringify(entry) + "\n",
      "utf-8"
    );
  } catch {
    /* audit must never break the payout path */
  }
}
