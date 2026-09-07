/**
 * Reconciliation Watchdog — compares internal ledger <-> provider ledger
 * <-> external evidence and names every mismatch. It never pays anything.
 *
 * Settlement-gap P1 (2026-09-07). The PayPal REST-history gap (Aug 26-28,
 * 2026) proved webhook evidence alone is insufficient — so reconciliation is
 * an explicit, first-class status, and missing evidence is EVIDENCE_PENDING,
 * never a reason to re-pay.
 */

export type ReconMatchStatus =
  | 'MATCHED'
  | 'EVIDENCE_PENDING'
  | 'MISSING_PROVIDER'
  | 'MISSING_INTERNAL'
  | 'AMOUNT_MISMATCH'
  | 'CURRENCY_MISMATCH'
  | 'DUPLICATE'
  | 'UNKNOWN';

export interface InternalRecord {
  payoutId: string;
  idempotencyKey: string;
  amount: number;
  currency: string;
  providerTransactionId?: string | null;
}

export interface ProviderRecord {
  providerTransactionId: string;
  amount: number;
  currency: string;
}

export interface ReconFinding {
  status: ReconMatchStatus;
  payoutId?: string;
  providerTransactionId?: string;
  expected?: { amount: number; currency: string };
  found?: { amount: number; currency: string };
  /** AMOUNT_MISMATCH is computed with a tolerance for FX/fee rounding. */
  delta?: number;
}

const AMOUNT_TOLERANCE = 0.01;

/** Pure three-way comparison for one currency at a time. */
export function reconcilePayout(
  internal: InternalRecord,
  provider: ProviderRecord | undefined,
  allProviderRecords: readonly ProviderRecord[]
): ReconFinding {
  if (!internal.providerTransactionId) {
    // No external reference yet — an evidence gap, not proof of non-payment.
    // Never triggers a re-pay; triggers investigation/quarantine.
    return { status: 'EVIDENCE_PENDING', payoutId: internal.payoutId };
  }
  if (!provider) {
    return {
      status: 'MISSING_PROVIDER',
      payoutId: internal.payoutId,
      providerTransactionId: internal.providerTransactionId,
      expected: { amount: internal.amount, currency: internal.currency },
    };
  }
  const delta = provider.amount - internal.amount;
  if (Math.abs(delta) > AMOUNT_TOLERANCE) {
    return {
      status: 'AMOUNT_MISMATCH',
      payoutId: internal.payoutId,
      expected: { amount: internal.amount, currency: internal.currency },
      found: { amount: provider.amount, currency: provider.currency },
      delta: Math.round(delta * 100) / 100,
    };
  }
  if (provider.currency !== internal.currency) {
    return {
      status: 'CURRENCY_MISMATCH',
      payoutId: internal.payoutId,
      expected: { amount: internal.amount, currency: internal.currency },
      found: { amount: provider.amount, currency: provider.currency },
    };
  }
  const duplicates = allProviderRecords.filter(
    (r) =>
      r.providerTransactionId === provider.providerTransactionId &&
      r !== provider
  );
  if (duplicates.length > 0) {
    return {
      status: 'DUPLICATE',
      payoutId: internal.payoutId,
      providerTransactionId: provider.providerTransactionId,
    };
  }
  return {
    status: 'MATCHED',
    payoutId: internal.payoutId,
    providerTransactionId: provider.providerTransactionId,
  };
}

/** Provider-side records with no internal counterpart — money that moved
 *  without an instruction. Always a RECONCILIATION_REQUIRED incident. */
export function findOrphanProviderRecords(
  internals: readonly InternalRecord[],
  providers: readonly ProviderRecord[]
): ReconFinding[] {
  const known = new Set(internals.map((i) => i.providerTransactionId).filter(Boolean));
  return providers
    .filter((p) => !known.has(p.providerTransactionId))
    .map((p) => ({
      status: 'MISSING_INTERNAL' as ReconMatchStatus,
      providerTransactionId: p.providerTransactionId,
      found: { amount: p.amount, currency: p.currency },
    }));
}
