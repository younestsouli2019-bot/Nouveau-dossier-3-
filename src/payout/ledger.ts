/**
 * Owner ledger — balances are DERIVED, never stored as mutable buckets.
 *
 * Settlement-gap P0 (2026-09-07). The classic failure this replaces:
 *   balance says $985 but nobody knows WHY.
 * Every spendable figure must decompose into named ledger entries, so any
 * number can always be answered with "because of these lines".
 *
 * available(owner) = credits - reservations - settledPayouts
 */

export type LedgerEntryType =
  | 'REVENUE'
  | 'PLATFORM_FEE'
  | 'OWNER_ENTITLEMENT'
  | 'PAYOUT_RESERVED'
  | 'PAYOUT_SETTLED'
  | 'PAYOUT_RELEASED'
  | 'ADJUSTMENT';

export interface LedgerEntry {
  id: string;
  ownerAccountId: string;
  type: LedgerEntryType;
  currency: string;
  /** Signed amount in minor-independent units (matches repo convention: Float). */
  amount: number;
  /** Reference to the durable object that justifies this line (RevenueEvent, Payout, …). */
  sourceRef: string;
  occurredAt: string; // ISO 8601
}

export interface DerivedBalance {
  ownerAccountId: string;
  currency: string;
  credits: number;
  reservations: number;
  settledPayouts: number;
  /** credits - reservations - settledPayouts. The only number consumers may treat as spendable. */
  available: number;
}

/** Pure derivation: fold ledger entries into an explained balance. */
export function deriveBalance(
  ownerAccountId: string,
  currency: string,
  entries: readonly LedgerEntry[]
): DerivedBalance {
  let credits = 0;
  let reservations = 0;
  let settledPayouts = 0;

  for (const e of entries) {
    if (e.ownerAccountId !== ownerAccountId || e.currency !== currency) continue;
    switch (e.type) {
      case 'REVENUE':
      case 'OWNER_ENTITLEMENT':
      case 'ADJUSTMENT':
        credits += e.amount;
        break;
      case 'PAYOUT_RESERVED':
        reservations += e.amount;
        break;
      case 'PAYOUT_SETTLED':
        settledPayouts += e.amount;
        break;
      case 'PAYOUT_RELEASED':
        // a reservation released back to spendable
        reservations -= e.amount;
        break;
      case 'PLATFORM_FEE':
        credits -= e.amount;
        break;
    }
  }

  return {
    ownerAccountId,
    currency,
    credits,
    reservations,
    settledPayouts,
    available: credits - reservations - settledPayouts,
  };
}

/**
 * Integrity rule: a payout may only be RESERVED when the derived available
 * balance covers it. Reservations can never push `available` negative.
 */
export function canReserve(
  payoutAmount: number,
  balance: DerivedBalance
): boolean {
  return payoutAmount > 0 && balance.available - payoutAmount >= 0;
}
