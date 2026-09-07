/**
 * Prisma-backed WatchdogSources — real, READ-ONLY database reads that feed
 * the Treasury and Reconciliation watchdogs. Settlement-gap P1 (2026-09-07).
 *
 * Invariants:
 *  - Read-only: this module never calls create/update/delete on any model.
 *  - Structural typing: the Prisma client is passed in, never imported here,
 *    so unit tests run without a generated client and this module stays
 *    runtime-agnostic.
 *  - No raw destinations: only ids, statuses, amounts, and fingerprints flow
 *    out of these queries.
 */

import type { WatchdogSources } from '../treasury/watchdog';
import { HOLD_REASONS, type HoldReason, type HoldRecord } from './eligibility';
import type { LedgerEntry, LedgerEntryType } from './ledger';
import type { PayoutStatus } from './state-machine';

/** Minimal structural slices of the generated Prisma client (read-only). */
export interface PayoutRow {
  id: string;
  currency: string;
  netAmount: number;
  status: string;
  providerTransactionId: string | null;
  reconciliationStatus: string;
}

export interface HoldRow {
  payoutId: string;
  holdReason: string;
  createdAt: Date;
  nextReviewAt: Date;
  expiresAt: Date | null;
  releasedAt: Date | null;
}

export interface EntryRow {
  id: string;
  accountId: string;
  amount: number;
  entryType: string; // DEBIT | CREDIT
  state: string; // UNSETTLED | AUTHORIZED | AVAILABLE | RECOGNIZED | SETTLED | CLEARED | FAILED | ROLLED_BACK
  idempotencyKey: string;
  processorRef: string | null;
  metadata: unknown;
  createdAt: Date;
  account?: { currency: string; ownerId: string | null };
}

export interface WatchdogPrismaClient {
  payout: { findMany(args?: Record<string, unknown>): Promise<PayoutRow[]> };
  payoutHold: { findMany(args?: Record<string, unknown>): Promise<HoldRow[]> };
  revenueLedgerEntry: { findMany(args?: Record<string, unknown>): Promise<EntryRow[]> };
}

/** Payouts in flight: submitted/processing/UNKNOWN and not yet reconciled. */
const IN_FLIGHT_STATUSES = ['SUBMITTED', 'PROCESSING', 'UNKNOWN'];

export function mapPayoutRow(row: PayoutRow): {
  id: string;
  status: PayoutStatus;
  currency: string;
  netAmount: number;
  providerTransactionId?: string | null;
} {
  return {
    id: row.id,
    status: row.status as PayoutStatus,
    currency: row.currency,
    netAmount: row.netAmount,
    providerTransactionId: row.providerTransactionId,
  };
}

/**
 * A hold with a non-legal reason (legacy data) is coerced to the most
 * conservative legal reason — it must still surface for review, and the
 * watchdog only ever acts on legal reasons. Count is reported in the tick.
 */
export function mapHoldRow(row: HoldRow): { record: HoldRecord; coerced: boolean } {
  const legal = (HOLD_REASONS as readonly string[]).includes(row.holdReason);
  return {
    coerced: !legal,
    record: {
      payoutId: row.payoutId,
      holdReason: (legal ? row.holdReason : 'HELD_POLICY_REVIEW') as HoldReason,
      createdAt: row.createdAt.toISOString(),
      nextReviewAt: row.nextReviewAt.toISOString(),
      expiresAt: row.expiresAt?.toISOString(),
      releasedAt: row.releasedAt?.toISOString(),
    },
  };
}

/**
 * Map a RevenueLedgerEntry row onto the payout-domain LedgerEntry.
 *
 * Writers in the payout domain stamp `metadata.ledgerType` with the exact
 * LedgerEntryType. Legacy revenue rows without a stamp fall back to a
 * conservative state-based mapping so nothing inflates spendable balance:
 *   - CREDIT                    -> ADJUSTMENT (counts toward credits)
 *   - DEBIT + SETTLED/CLEARED   -> PAYOUT_SETTLED
 *   - DEBIT + AUTHORIZED        -> PAYOUT_RESERVED
 *   - other DEBIT               -> ADJUSTMENT (negative -> reduces credits)
 */
export function mapEntryRow(row: EntryRow): LedgerEntry {
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const explicitType = typeof meta.ledgerType === 'string' ? (meta.ledgerType as LedgerEntryType) : undefined;

  let type: LedgerEntryType;
  if (explicitType) {
    type = explicitType;
  } else if (row.entryType === 'DEBIT' && (row.state === 'SETTLED' || row.state === 'CLEARED')) {
    type = 'PAYOUT_SETTLED';
  } else if (row.entryType === 'DEBIT' && row.state === 'AUTHORIZED') {
    type = 'PAYOUT_RESERVED';
  } else {
    type = 'ADJUSTMENT';
  }

  const signed = row.entryType === 'CREDIT' ? Math.abs(row.amount) : -Math.abs(row.amount);

  return {
    id: row.id,
    ownerAccountId: row.account?.ownerId ?? row.accountId,
    type,
    currency: row.account?.currency ?? 'USD',
    amount: signed,
    sourceRef: (typeof meta.sourceRef === 'string' && meta.sourceRef) || row.processorRef || row.idempotencyKey,
    occurredAt: row.createdAt.toISOString(),
  };
}

export function createPrismaWatchdogSources(prisma: WatchdogPrismaClient): WatchdogSources {
  return {
    async listUnreconciledPayouts() {
      const rows = await prisma.payout.findMany({
        where: { status: { in: IN_FLIGHT_STATUSES }, reconciliationStatus: { not: 'RECONCILED' } },
        select: { id: true, currency: true, netAmount: true, status: true, providerTransactionId: true, reconciliationStatus: true },
      });
      return rows.map(mapPayoutRow);
    },

    async listActiveHolds() {
      const rows = await prisma.payoutHold.findMany({
        where: { releasedAt: null },
      });
      return rows.map((r) => mapHoldRow(r).record);
    },

    async listOwnerLedger(ownerAccountId: string, currency: string) {
      const rows = await prisma.revenueLedgerEntry.findMany({
        where: {
          account: { OR: [{ ownerId: ownerAccountId }, { id: ownerAccountId }], currency },
        },
        include: { account: { select: { currency: true, ownerId: true } } },
      });
      return rows.map(mapEntryRow);
    },
  };
}
