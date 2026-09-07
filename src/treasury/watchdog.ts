/**
 * Treasury Watchdog — the permanent answer to "why is revenue not reaching
 * the owner?" It DIAGNOSES, it never dispatches.
 *
 * Settlement-gap P1 (2026-09-07). Runs continuously (scheduler) against
 * injected, read-only sources. Findings become tasks/proposals — a
 * PAYOUT_READY finding still requires the full policy path before any
 * money moves.
 */

import type { PayoutStatus } from '../payout/state-machine';
import { isStale, describeStaleHold, type HoldRecord } from '../payout/eligibility';
import { deriveBalance, type LedgerEntry } from '../payout/ledger';

export interface WatchdogSources {
  /** Payouts that should have completed but have not. */
  listUnreconciledPayouts(): Promise<
    Array<{ id: string; status: PayoutStatus; currency: string; netAmount: number; providerTransactionId?: string | null }>
  >;
  /** Holds whose review time has passed or that have aged out. */
  listActiveHolds(): Promise<HoldRecord[]>;
  /** Ledger entries for the owner account. */
  listOwnerLedger(ownerAccountId: string, currency: string): Promise<LedgerEntry[]>;
}

export type WatchdogFinding =
  | { kind: 'STALE_HOLD'; detail: ReturnType<typeof describeStaleHold> }
  | { kind: 'UNRECONCILED_PAYOUT'; detail: { id: string; status: PayoutStatus } }
  | { kind: 'UNKNOWN_PROVIDER_OPERATION'; detail: { id: string } }
  | { kind: 'MISSING_EXTERNAL_REFERENCE'; detail: { id: string; status: PayoutStatus } }
  | { kind: 'ELIGIBLE_FOR_PAYOUT'; detail: { ownerAccountId: string; currency: string; available: number } }
  | { kind: 'RECONCILIATION_GAP'; detail: { id: string } };

export async function scanTreasury(
  sources: WatchdogSources,
  opts: { ownerAccountId: string; currency: string; now?: Date }
): Promise<WatchdogFinding[]> {
  const now = opts.now ?? new Date();
  const findings: WatchdogFinding[] = [];

  // 1. stale held balances — every hold gets a reason and a next review;
  //    anything aged past the threshold is surfaced, never silently parked.
  for (const hold of await sources.listActiveHolds()) {
    if (isStale(hold, now)) {
      findings.push({ kind: 'STALE_HOLD', detail: describeStaleHold(hold, now) });
    }
  }

  // 2. payouts stuck without reconciliation or external reference.
  for (const p of await sources.listUnreconciledPayouts()) {
    if (p.status === 'UNKNOWN') {
      findings.push({ kind: 'UNKNOWN_PROVIDER_OPERATION', detail: { id: p.id } });
      continue; // UNKNOWN is quarantined-waiting; reconciliation watchdog owns it
    }
    if (p.status === 'COMPLETED' && !p.providerTransactionId) {
      findings.push({ kind: 'MISSING_EXTERNAL_REFERENCE', detail: { id: p.id, status: p.status } });
    }
    if (p.status === 'SUBMITTED' || p.status === 'PROCESSING') {
      findings.push({ kind: 'RECONCILIATION_GAP', detail: { id: p.id } });
    }
  }

  // 3. eligible funds — informational only. Producing this finding creates a
  //    PAYOUT PROPOSAL, not a payment. Policy/limits/batch guards still apply.
  const balance = deriveBalance(
    opts.ownerAccountId,
    opts.currency,
    await sources.listOwnerLedger(opts.ownerAccountId, opts.currency)
  );
  if (balance.available > 0) {
    findings.push({
      kind: 'ELIGIBLE_FOR_PAYOUT',
      detail: {
        ownerAccountId: opts.ownerAccountId,
        currency: opts.currency,
        available: balance.available,
      },
    });
  }

  return findings;
}
