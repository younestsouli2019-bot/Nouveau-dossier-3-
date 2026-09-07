/**
 * Payout reconciliation — the ONLY path from SUBMITTED to RECONCILED.
 * Settlement-gap P2 (2026-09-07).
 *
 * Invariants (owner-mandated):
 *  - Provider truth decides: states advance ONLY on what the provider actually
 *    reports (fetchStatus). Nothing here is inferred, assumed, or fabricated.
 *  - UNKNOWN resolves exclusively via provider reconciliation: COMPLETED (found)
 *    or QUARANTINED (confirmed failed). It NEVER loops back to READY.
 *  - Only reconciliation establishes settled truth: COMPLETED books the
 *    PAYOUT_SETTLED ledger entry (idempotent by key), and only then the payout
 *    may transition COMPLETED -> RECONCILED.
 *  - No money movement: this module never calls provider.submit. It is safe to
 *    run as part of a scheduled tick — it only books provider-side facts.
 *  - Atomic + idempotent: every transition is optimistic-versioned; the ledger
 *    booking key is `payout-settled:<payoutId>` so a crash between booking and
 *    the RECONCILED transition simply re-books nothing and finishes the move.
 */

import type { PayoutProvider, DestinationType } from './provider';
import { getProviderForDestination } from './provider';
import { atomicTransition, providerConfigFromEnv, type DispatchDeps, type DispatchPayoutRow } from './dispatch';

export interface ReconcileDeps extends DispatchDeps {
  /** Ledger booking store — structural slice (create is idempotent by key). */
  ledger?: {
    findUnique(args?: Record<string, unknown>): Promise<{ id: string } | null>;
    create(args: Record<string, unknown>): Promise<{ id: string }>;
  };
}

export type ReconcileOutcome =
  | { ok: true; payoutId: string; from: string; to: string; verdict: string }
  | { ok: false; payoutId?: string; error: string; flagged?: boolean };

export function reconcileDepsWithLedger(deps: ReconcileDeps): Required<Pick<ReconcileDeps, 'ledger'>> & ReconcileDeps {
  // The default ledger store is the same prisma client (revenueLedgerEntry).
  const ledger =
    deps.ledger ??
    ((deps.prisma as unknown as {
      revenueLedgerEntry?: ReconcileDeps['ledger'];
    }).revenueLedgerEntry as ReconcileDeps['ledger']);
  if (!ledger) {
    throw new Error('reconcile: ledger store not provided (revenueLedgerEntry)');
  }
  return { ...deps, ledger };
}

/** Book the PAYOUT_SETTLED ledger line — idempotent by key. */
async function bookSettlement(
  payout: DispatchPayoutRow,
  deps: ReconcileDeps,
  evidence: Record<string, unknown>
): Promise<{ ok: true; ledgerEntryId: string } | { ok: false; error: string }> {
  const key = `payout-settled:${payout.id}`;
  const existing = await deps.ledger!.findUnique({ where: { idempotencyKey: key } });
  if (existing) return { ok: true, ledgerEntryId: existing.id };
  const created = await deps.ledger!.create({
    data: {
      idempotencyKey: key,
      entryType: 'DEBIT',
      state: 'SETTLED',
      amount: payout.netAmount,
      processorRef: payout.providerTransactionId ?? null,
      metadata: {
        ledgerType: 'PAYOUT_SETTLED',
        payoutId: payout.id,
        currency: payout.currency,
        destinationFingerprint: payout.destinationFingerprint,
        evidence,
      },
    },
  });
  return { ok: true, ledgerEntryId: created.id };
}

/**
 * Advance ONE payout along SUBMITTED/PROCESSING/UNKNOWN/COMPLETED toward
 * RECONCILED, strictly on provider-reported truth.
 */
export async function advancePayoutReconciliation(
  payoutId: string,
  depsIn: ReconcileDeps
): Promise<ReconcileOutcome> {
  const deps = reconcileDepsWithLedger(depsIn);
  const payout = await deps.prisma.payout.findUnique({ where: { id: payoutId } });
  if (!payout) return { ok: false, error: `payout ${payoutId} not found` };

  const advanceable = ['SUBMITTED', 'PROCESSING', 'UNKNOWN', 'COMPLETED'];
  if (!advanceable.includes(payout.status)) {
    return { ok: false, payoutId, error: `reconcile only ${advanceable.join('/')} (current: ${payout.status})` };
  }

  // COMPLETED but not yet reconciled: finish the ledger booking + transition.
  if (payout.status === 'COMPLETED') {
    if (payout.reconciliationStatus === 'RECONCILED') {
      return { ok: true, payoutId, from: 'COMPLETED', to: 'RECONCILED', verdict: 'already reconciled' };
    }
    return finishReconciled(payout, deps, { source: 'previously completed' });
  }

  if (!payout.providerRequestId) {
    // Cannot poll — flag for provider-side history pull (P2 REST wiring).
    await deps.prisma.payout.updateMany({
      where: { id: payoutId, version: payout.version },
      data: { reconciliationStatus: 'RECONCILIATION_REQUIRED' },
    });
    await deps.prisma.payoutEvent.create({
      data: {
        payoutId,
        fromStatus: payout.status,
        toStatus: payout.status,
        actor: 'watchdog',
        reason: 'no providerRequestId on an in-flight/UNKNOWN payout — provider-side history pull required (P2)',
      },
    });
    return {
      ok: false,
      payoutId,
      flagged: true,
      error: `cannot poll ${payout.status} payout: no provider request id — flagged RECONCILIATION_REQUIRED for provider-side history pull`,
    };
  }

  const config = providerConfigFromEnv(deps.env ?? process.env);
  const providerFor =
    deps.providerFor ??
    ((dt: DestinationType, cfg: Parameters<NonNullable<ReconcileDeps['providerFor']>>[1]) =>
      getProviderForDestination(dt, cfg));
  const provider: PayoutProvider = providerFor(
    payout.destinationType as DestinationType,
    config
  );

  let verdict: Awaited<ReturnType<PayoutProvider['fetchStatus']>>;
  try {
    verdict = await provider.fetchStatus(payout.providerRequestId);
  } catch (err) {
    return {
      ok: false,
      payoutId,
      error: `provider status fetch failed (payout stays ${payout.status}): ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const now = deps.now ?? (() => new Date());

  if (verdict.status === 'PENDING') {
    if (payout.status === 'SUBMITTED') {
      const moved = await atomicTransition(deps.prisma, {
        payoutId,
        from: 'SUBMITTED',
        to: 'PROCESSING',
        actor: 'provider',
        reason: 'provider reports PENDING — instruction accepted and processing',
        expectedVersion: payout.version,
        data: {
          providerTransactionId: verdict.providerTransactionId ?? payout.providerTransactionId,
        },
        evidence: verdict.evidence,
      });
      if (moved.ok === false) return { ok: false, payoutId, error: moved.error };
      return { ok: true, payoutId, from: 'SUBMITTED', to: 'PROCESSING', verdict: 'PENDING (accepted)' };
    }
    return { ok: true, payoutId, from: payout.status, to: payout.status, verdict: 'PENDING (still processing)' };
  }

  if (verdict.status === 'COMPLETED') {
    const txId = verdict.providerTransactionId ?? payout.providerTransactionId;
    let current = { ...payout, providerTransactionId: txId };
    // SUBMITTED -> PROCESSING first (legal route), then PROCESSING/UNKNOWN -> COMPLETED.
    if (current.status === 'SUBMITTED') {
      const processing = await atomicTransition(deps.prisma, {
        payoutId,
        from: 'SUBMITTED',
        to: 'PROCESSING',
        actor: 'provider',
        reason: 'provider reports the instruction accepted/processing en route to COMPLETED',
        expectedVersion: current.version,
        data: { providerTransactionId: txId },
        evidence: verdict.evidence,
      });
      if (processing.ok === false) return { ok: false, payoutId, error: processing.error };
      current = { ...current, status: 'PROCESSING', version: processing.newVersion };
    }
    if (current.status !== 'COMPLETED') {
      const done = await atomicTransition(deps.prisma, {
        payoutId,
        from: current.status as 'PROCESSING' | 'UNKNOWN',
        to: 'COMPLETED',
        actor: 'provider',
        reason: 'provider reports COMPLETED — real settlement evidence recorded',
        expectedVersion: current.version,
        data: {
          providerTransactionId: txId,
          completedAt: now(),
        },
        evidence: verdict.evidence,
      });
      if (done.ok === false) return { ok: false, payoutId, error: done.error };
      current = { ...current, status: 'COMPLETED', version: done.newVersion };
    }
    return finishReconciled(current, deps, verdict.evidence);
  }

  if (verdict.status === 'FAILED') {
    if (payout.status === 'UNKNOWN') {
      // Confirmed failed at the provider: resolves UNKNOWN — quarantine (never retry).
      const quarantined = await atomicTransition(deps.prisma, {
        payoutId,
        from: 'UNKNOWN',
        to: 'QUARANTINED',
        actor: 'provider',
        reason: 'provider confirms the instruction FAILED — UNKNOWN resolved to QUARANTINED (no retry)',
        expectedVersion: payout.version,
        data: {
          providerTransactionId: verdict.providerTransactionId ?? payout.providerTransactionId,
          failureCode: 'PROVIDER_CONFIRMED_FAILED',
          failureReason: 'provider reports the operation failed',
          failedAt: now(),
          reconciliationStatus: 'QUARANTINED',
        },
        evidence: verdict.evidence,
      });
      if (quarantined.ok === false) return { ok: false, payoutId, error: quarantined.error };
      return { ok: true, payoutId, from: 'UNKNOWN', to: 'QUARANTINED', verdict: 'FAILED (quarantined — owner review)' };
    }
    const rejected = await atomicTransition(deps.prisma, {
      payoutId,
      from: payout.status as 'SUBMITTED' | 'PROCESSING',
      to: 'PROVIDER_REJECTED',
      actor: 'provider',
      reason: 'provider reports FAILED',
      expectedVersion: payout.version,
      data: {
        providerTransactionId: verdict.providerTransactionId ?? payout.providerTransactionId,
        failureCode: 'PROVIDER_REPORTED_FAILED',
        failureReason: 'provider reports the operation failed',
        failedAt: now(),
      },
      evidence: verdict.evidence,
    });
    if (rejected.ok === false) return { ok: false, payoutId, error: rejected.error };
    return { ok: true, payoutId, from: payout.status, to: 'PROVIDER_REJECTED', verdict: 'FAILED' };
  }

  // verdict UNKNOWN: verdict still unknown at the provider — keep status, flag.
  await deps.prisma.payout.updateMany({
    where: { id: payoutId, version: payout.version },
    data: { reconciliationStatus: 'RECONCILIATION_REQUIRED' },
  });
  await deps.prisma.payoutEvent.create({
    data: {
      payoutId,
      fromStatus: payout.status,
      toStatus: payout.status,
      actor: 'provider',
      reason: 'provider verdict still UNKNOWN — flagged RECONCILIATION_REQUIRED (no retry, no state change)',
      evidence: verdict.evidence,
    },
  });
  return {
    ok: false,
    payoutId,
    flagged: true,
    error: `provider verdict UNKNOWN — payout stays ${payout.status}, flagged RECONCILIATION_REQUIRED`,
  };
}

async function finishReconciled(
  payout: DispatchPayoutRow,
  deps: ReconcileDeps,
  evidence: Record<string, unknown>
): Promise<ReconcileOutcome> {
  const booked = await bookSettlement(payout, deps, evidence);
  if (booked.ok === false) return { ok: false, payoutId: payout.id, error: booked.error };
  if (payout.reconciliationStatus === 'RECONCILED') {
    // Ledger was already booked; make sure the state machine agrees.
    if (payout.status !== 'RECONCILED') {
      const done = await atomicTransition(deps.prisma, {
        payoutId: payout.id,
        from: 'COMPLETED',
        to: 'RECONCILED',
        actor: 'system',
        reason: `settlement ledger booked (${booked.ledgerEntryId}) — payout fully executed`,
        expectedVersion: payout.version,
        data: { reconciliationStatus: 'RECONCILED' },
      });
      if (done.ok === false) return { ok: false, payoutId: payout.id, error: done.error };
      return { ok: true, payoutId: payout.id, from: 'COMPLETED', to: 'RECONCILED', verdict: 'settled + reconciled' };
    }
    return { ok: true, payoutId: payout.id, from: 'RECONCILED', to: 'RECONCILED', verdict: 'already reconciled' };
  }
  const done = await atomicTransition(deps.prisma, {
    payoutId: payout.id,
    from: 'COMPLETED',
    to: 'RECONCILED',
    actor: 'system',
    reason: `settlement ledger booked (${booked.ledgerEntryId}) — payout fully executed`,
    expectedVersion: payout.version,
    data: { reconciliationStatus: 'RECONCILED' },
  });
  if (done.ok === false) return { ok: false, payoutId: payout.id, error: done.error };
  return { ok: true, payoutId: payout.id, from: 'COMPLETED', to: 'RECONCILED', verdict: 'settled + reconciled' };
}

export interface ReconcileAllSummary {
  checked: number;
  advanced: number;
  flagged: number;
  errors: number;
}

/** Sweep all in-flight/completed-unreconciled payouts once. */
export async function reconcileAllPayouts(deps: ReconcileDeps): Promise<ReconcileAllSummary> {
  const rows = await deps.prisma.payout.findMany({
    where: {
      OR: [
        { status: { in: ['SUBMITTED', 'PROCESSING', 'UNKNOWN'] } },
        { AND: [{ status: 'COMPLETED' }, { reconciliationStatus: { not: 'RECONCILED' } }] },
      ],
    },
  });
  const summary: ReconcileAllSummary = { checked: 0, advanced: 0, flagged: 0, errors: 0 };
  for (const row of rows) {
    summary.checked++;
    const outcome = await advancePayoutReconciliation(row.id, deps);
    if (outcome.ok === true) summary.advanced++;
    else {
      if (outcome.flagged) summary.flagged++;
      summary.errors++;
    }
  }
  return summary;
}
