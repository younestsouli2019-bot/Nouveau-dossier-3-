import { describe, expect, it } from 'vitest';
import {
  createPrismaWatchdogSources,
  mapEntryRow,
  mapHoldRow,
  mapPayoutRow,
  type EntryRow,
  type HoldRow,
} from '../prisma-sources';

const FP_UNUSED = 'f'.repeat(64);

describe('mapPayoutRow', () => {
  it('passes through only id/status/currency/amount/provider ref', () => {
    const mapped = mapPayoutRow({
      id: 'po_1',
      currency: 'USD',
      netAmount: 10,
      status: 'SUBMITTED',
      providerTransactionId: 'TX-9',
      reconciliationStatus: 'PENDING',
    });
    expect(mapped).toEqual({
      id: 'po_1',
      status: 'SUBMITTED',
      currency: 'USD',
      netAmount: 10,
      providerTransactionId: 'TX-9',
    });
  });
});

describe('mapHoldRow', () => {
  const base: HoldRow = {
    payoutId: 'po_1',
    holdReason: 'HELD_MINIMUM_THRESHOLD',
    createdAt: new Date('2026-09-01T00:00:00Z'),
    nextReviewAt: new Date('2026-09-08T00:00:00Z'),
    expiresAt: null,
    releasedAt: null,
  };

  it('maps legal reasons untouched with ISO strings', () => {
    const { record, coerced } = mapHoldRow(base);
    expect(coerced).toBe(false);
    expect(record.holdReason).toBe('HELD_MINIMUM_THRESHOLD');
    expect(record.createdAt).toBe('2026-09-01T00:00:00.000Z');
  });

  it('coerces legacy/illegal reasons to the conservative review reason', () => {
    const { record, coerced } = mapHoldRow({ ...base, holdReason: 'SOME_LEGACY_REASON' });
    expect(coerced).toBe(true);
    expect(record.holdReason).toBe('HELD_POLICY_REVIEW');
  });
});

describe('mapEntryRow', () => {
  const base: EntryRow = {
    id: 'e1',
    accountId: 'acct_owner',
    amount: 100,
    entryType: 'CREDIT',
    state: 'AVAILABLE',
    idempotencyKey: 'idem-e1',
    processorRef: 'pr-1',
    metadata: {},
    createdAt: new Date('2026-09-01T00:00:00Z'),
    account: { currency: 'USD', ownerId: 'OWNER_MAIN' },
  };

  it('explicit metadata.ledgerType wins', () => {
    const mapped = mapEntryRow({ ...base, metadata: { ledgerType: 'OWNER_ENTITLEMENT' } });
    expect(mapped.type).toBe('OWNER_ENTITLEMENT');
    expect(mapped.amount).toBe(100); // CREDIT stays positive
  });

  it('legacy DEBIT+SETTLED maps to PAYOUT_SETTLED (conservative fallback)', () => {
    const mapped = mapEntryRow({ ...base, entryType: 'DEBIT', state: 'SETTLED' });
    expect(mapped.type).toBe('PAYOUT_SETTLED');
    expect(mapped.amount).toBe(-100);
  });

  it('legacy DEBIT+AUTHORIZED maps to PAYOUT_RESERVED', () => {
    const mapped = mapEntryRow({ ...base, entryType: 'DEBIT', state: 'AUTHORIZED' });
    expect(mapped.type).toBe('PAYOUT_RESERVED');
  });

  it('sourceRef falls back processorRef then idempotencyKey; ownerAccountId prefers account.ownerId', () => {
    const mapped = mapEntryRow({ ...base, processorRef: null });
    expect(mapped.sourceRef).toBe('idem-e1');
    expect(mapped.ownerAccountId).toBe('OWNER_MAIN');
    expect(FP_UNUSED).toHaveLength(64); // keeps FP import meaningful
  });
});

describe('createPrismaWatchdogSources (read-only wiring)', () => {
  it('listOwnerLedger maps rows through mapEntryRow', async () => {
    const rows: EntryRow[] = [
      {
        id: 'e1',
        accountId: 'a',
        amount: 50,
        entryType: 'CREDIT',
        state: 'AVAILABLE',
        idempotencyKey: 'k1',
        processorRef: null,
        metadata: { ledgerType: 'OWNER_ENTITLEMENT' },
        createdAt: new Date(),
        account: { currency: 'USD', ownerId: 'OWNER_MAIN' },
      },
    ];
    const prisma = {
      payout: { findMany: async () => [] },
      payoutHold: { findMany: async () => [] },
      revenueLedgerEntry: { findMany: async () => rows },
    };
    const sources = createPrismaWatchdogSources(prisma);
    const entries = await sources.listOwnerLedger('OWNER_MAIN', 'USD');
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('OWNER_ENTITLEMENT');
  });
});
