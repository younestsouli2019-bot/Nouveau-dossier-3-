/**
 * Prisma-backed PayoutStore — the transactional persistence for the payout
 * pipeline driver. Settlement-gap P0 (2026-09-07).
 *
 * Concurrency model:
 *  - applyTransition is ONE prisma transaction: version CAS on Payout
 *    (updateMany where version = expected), the immutable PayoutEvent append,
 *    and (when supplied) the RevenueLedgerEntry write. A crash or a racing
 *    tick can never observe a half-applied transition.
 *  - Ledger writes are idempotent via the unique idempotencyKey
 *    (`payout:{id}:{TYPE}`) — a replay is a no-op, never a double line.
 */

import type { PrismaClient } from '@prisma/client';
import {
  DRIVE_STATUSES,
  type ApplyResult,
  type ApplyTransitionArgs,
  type PayoutRecord,
  type PayoutStore,
} from './pipeline';
import type { LedgerEntry } from './ledger';
import { mapEntryRow, type EntryRow } from './prisma-sources';

const FAILURE_STATUSES = ['RETRYABLE_FAILURE', 'PROVIDER_REJECTED'] as const;

export function createPrismaPayoutStore(prisma: PrismaClient): PayoutStore {
  return {
    async getPayout(id: string): Promise<PayoutRecord | null> {
      const row = await prisma.payout.findUnique({ where: { id } });
      if (!row) return null;
      return {
        id: row.id,
        ownerAccountId: row.ownerAccountId,
        settlementId: row.settlementId,
        currency: row.currency,
        grossAmount: row.grossAmount,
        feeAmount: row.feeAmount,
        netAmount: row.netAmount,
        destinationType: row.destinationType,
        destinationFingerprint: row.destinationFingerprint,
        idempotencyKey: row.idempotencyKey,
        status: row.status,
        provider: row.provider,
        providerRequestId: row.providerRequestId,
        providerTransactionId: row.providerTransactionId,
        reconciliationStatus: row.reconciliationStatus,
        version: row.version,
      };
    },

    async listDrivablePayoutIds(limit: number): Promise<string[]> {
      const rows = await prisma.payout.findMany({
        where: { status: { in: [...DRIVE_STATUSES] } },
        orderBy: { updatedAt: 'asc' },
        select: { id: true },
        take: Math.max(1, limit),
      });
      return rows.map((r: { id: string }) => r.id);
    },

    async listLedgerEntries(ownerAccountId: string, currency: string): Promise<readonly LedgerEntry[]> {
      const rows = (await prisma.revenueLedgerEntry.findMany({
        where: {
          account: { OR: [{ ownerId: ownerAccountId }, { id: ownerAccountId }], currency },
        },
        include: { account: { select: { currency: true, ownerId: true } } },
        orderBy: { createdAt: 'asc' },
      })) as unknown as EntryRow[];
      return rows.map((r) => mapEntryRow(r));
    },

    async hasActiveHold(payoutId: string): Promise<boolean> {
      const hold = await prisma.payoutHold.findFirst({
        where: { payoutId, releasedAt: null },
        select: { id: true },
      });
      return hold !== null;
    },

    async countFailedSubmitsToday(payoutId: string): Promise<number> {
      const start = new Date();
      start.setUTCHours(0, 0, 0, 0);
      return prisma.payoutEvent.count({
        where: {
          payoutId,
          toStatus: { in: [...FAILURE_STATUSES] },
          createdAt: { gte: start },
        },
      });
    },

    async countProviderPolls(payoutId: string, sinceISO: string): Promise<number> {
      return prisma.payoutEvent.count({
        where: {
          payoutId,
          actor: 'provider',
          reason: { startsWith: 'no verdict' },
          createdAt: { gte: new Date(sinceISO) },
        },
      });
    },

    async recordProviderPoll(payoutId: string, reason: string): Promise<void> {
      const payout = await prisma.payout.findUnique({
        where: { id: payoutId },
        select: { status: true },
      });
      await prisma.payoutEvent.create({
        data: {
          payoutId,
          toStatus: payout?.status ?? 'UNKNOWN',
          actor: 'provider',
          reason,
        },
      });
    },

    async applyTransition(args: ApplyTransitionArgs): Promise<ApplyResult> {
      const { payoutId, expectedVersion, from, to, actor, reason, evidence, patch, ledger } = args;
      try {
        const newVersion = expectedVersion + 1;
        await prisma.$transaction(async (tx) => {
          // 1. Version CAS — exactly one writer wins.
          const updated = await tx.payout.updateMany({
            where: { id: payoutId, version: expectedVersion },
            data: {
              status: to,
              version: newVersion,
              ...(patch?.provider !== undefined ? { provider: patch.provider } : {}),
              ...(patch?.providerRequestId !== undefined ? { providerRequestId: patch.providerRequestId } : {}),
              ...(patch?.providerTransactionId !== undefined ? { providerTransactionId: patch.providerTransactionId } : {}),
              ...(patch?.failureCode !== undefined ? { failureCode: patch.failureCode } : {}),
              ...(patch?.failureReason !== undefined ? { failureReason: patch.failureReason } : {}),
              ...(patch?.reconciliationStatus !== undefined ? { reconciliationStatus: patch.reconciliationStatus } : {}),
              ...(patch?.submittedAt !== undefined ? { submittedAt: new Date(patch.submittedAt) } : {}),
              ...(patch?.acceptedAt !== undefined ? { acceptedAt: new Date(patch.acceptedAt) } : {}),
              ...(patch?.completedAt !== undefined ? { completedAt: new Date(patch.completedAt) } : {}),
            },
          });
          if (updated.count !== 1) {
            throw new Error(`version conflict: expected ${expectedVersion} on ${payoutId}`);
          }

          // 2. Immutable history append.
          await tx.payoutEvent.create({
            data: {
              payoutId,
              fromStatus: from,
              toStatus: to,
              actor,
              reason,
              ...(evidence !== undefined ? { evidence: evidence as object } : {}),
            },
          });

          // 3. Ledger write (idempotent) — same transaction as the transition.
          if (ledger) {
            const payout = await tx.payout.findUnique({
              where: { id: payoutId },
              select: { ownerAccountId: true, currency: true },
            });
            if (!payout?.ownerAccountId) {
              throw new Error(`ledger write requires ownerAccountId (payout ${payoutId})`);
            }
            const account = await tx.ledgerAccount.findFirst({
              where: {
                OR: [{ ownerId: payout.ownerAccountId }, { id: payout.ownerAccountId }],
                currency: payout.currency,
              },
              select: { id: true },
            });
            if (!account) {
              throw new Error(`no ledger account for owner ${payout.ownerAccountId} ${payout.currency}`);
            }
            const existing = await tx.revenueLedgerEntry.findUnique({
              where: { idempotencyKey: ledger.idempotencyKey },
              select: { id: true },
            });
            if (!existing) {
              await tx.revenueLedgerEntry.create({
                data: {
                  accountId: account.id,
                  entryType: 'DEBIT',
                  state: ledger.type === 'PAYOUT_RESERVED' ? 'AUTHORIZED' : 'SETTLED',
                  amount: Math.abs(ledger.amount),
                  idempotencyKey: ledger.idempotencyKey,
                  processorRef: ledger.processorRef,
                  metadata: {
                    ledgerType: ledger.type,
                    sourceRef: ledger.processorRef,
                    payoutId,
                  },
                },
              });
            }
          }
        });
        return { ok: true, newVersion: expectedVersion + 1 };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
