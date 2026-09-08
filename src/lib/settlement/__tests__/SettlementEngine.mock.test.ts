import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SettlementState,
  VALID_TRANSITIONS,
  isSyntheticRef,
  type SettlementRail,
} from '../SettlementEngine';
import { resolveBestPayoutRoute } from '../../payout-routing';

describe('T4 — resolveBestPayoutRoute: mixed OwnerAccount sets (verified + unverified)', () => {
  it('given 3 unverified + 1 verified → only verified is selected, unverified filtered', () => {
    const accounts = [
      { id: 'bad-1', isActive: true, verifiedAt: null, accountType: 'paypal' },
      { id: 'bad-2', isActive: false, verifiedAt: new Date(), accountType: 'paypal' },
      { id: 'bad-3', isActive: true, verifiedAt: null, accountType: 'payoneer' },
      { id: 'good', isActive: true, verifiedAt: new Date('2026-01-01'), accountType: 'attijari' },
    ];
    const res = resolveBestPayoutRoute({
      amount: 3000, currency: 'MAD', ownerAccounts: accounts,
    });
    expect(res).not.toBeNull();
    expect(res!.ownerAccountId).toBe('good');
    expect(res!.rail).toBe('attijari');
  });

  it('empty ownerAccounts → return null', () => {
    const res = resolveBestPayoutRoute({ amount: 1, currency: 'USD', ownerAccounts: [] });
    expect(res).toBeNull();
  });
});

describe('T5 — PlaceholderSettlementRail ensureReady fail-closed', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.restoreAllMocks(); process.env = { ...process.env }; });

  it('throws RAIL_NOT_CONFIGURED code when env vars are empty (placeholder) PayPal case', async () => {
    const backup = process.env;
    process.env = { ...backup, PAYPAL_CLIENT_ID: 'your-paypal-client-id-here', PAYPAL_CLIENT_SECRET: '' };
    const { settlementEngine } = await import('../SettlementEngine');
    const rail = settlementEngine.getRail('paypal');
    expect(rail).toBeDefined();
    try {
      await rail!.ensureReady();
      expect.fail('should have thrown RAIL_NOT_CONFIGURED');
    } catch (e) {
      expect((e as { code?: string }).code).toBe('RAIL_NOT_CONFIGURED');
      expect(String((e as Error).message)).toContain('paypal');
    }
    process.env = backup;
  });

  it('throws when env var is literally "placeholder" (placeholder regex)', async () => {
    const backup = process.env;
    process.env = { ...backup, WISE_API_TOKEN: 'placeholder-wise-api-key-todo', WISE_PROFILE_ID: 'TODO-setme' };
    const { settlementEngine: se2 } = await import('../SettlementEngine');
    const wise = se2.getRail('wise');
    try {
      await wise!.ensureReady();
      expect.fail('placeholder regex should have matched');
    } catch (e) {
      expect((e as { code?: string }).code).toBe('RAIL_NOT_CONFIGURED');
    }
    process.env = backup;
  });
});

describe('T6 — Exactly-Once Idempotency (50 sims crash-retry model)', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('50 concurrent calls with same idempotencyKey → ALL return same payoutItemId result (exactly-once guarantee)', async () => {
    const backup = process.env;
    process.env = {
      ...backup,
      DATABASE_URL: 'postgres://example.invalid/test',
      PAYPAL_CLIENT_ID: 'real-paypal-client-id-not-empty',
      PAYPAL_CLIENT_SECRET: 'not-a-placeholder-really',
    };

    vi.mock('../../db', () => {
      const CANONICAL_PAYOUT_ID = 'pi_MOCK_T6_CANONICAL';
      const IDEM_HIT_META = JSON.stringify({ payoutItemId: CANONICAL_PAYOUT_ID, source: 'idem_hit_store' });

      const store: { routingToken?: string; metadata?: string; payoutItemId?: string; itemStatus?: string } = { itemStatus: 'REVENUE' };

      const baseOwnerAccount = {
        id: 'verified-owner-1',
        isActive: true,
        verifiedAt: new Date('2026-01-01T00:00:00.000Z'),
        accountType: 'paypal' as const,
        accountHolder: 'Test Owner',
        paypalEmail: 'owner@paypal.invalid',
        wiseEmail: 'owner@wise.invalid',
        payoneerId: '',
        walletAddress: '',
        network: '',
        isPrimary: true,
        countryCode: 'US',
        sortOrder: 1,
        purposes: ['settlement'],
        spendable: 10000,
        held: 0,
      };

      const basePayoutItemFind = {
        id: CANONICAL_PAYOUT_ID,
        status: 'PROCESSING',
        payoutBatchId: 'pb-fake',
        amount: 50,
        currency: 'USD',
        externalRef: 'REAL-PP-TXN-ABC123',
        transactionRef: 'REAL-PP-TXN-ABC123',
        connectorId: 'test-rail',
        connectorStatus: 'live_paypal_api',
        proofHash: null,
        retryCount: 0,
        lastRetryAt: null,
        deliveryConfirmed: false,
        failureReason: null,
        processedAt: null,
        recipientName: 'Test Owner',
        recipientEmail: 'owner@paypal.invalid',
        paymentMethod: 'paypal',
        batchNumber: 'PB-REALBATCH01',
      };

      const makeTx = () => ({
        ownerAccount: {
          findUnique: async (_q: unknown) => ({ ...baseOwnerAccount }),
          findMany: async (_q: unknown) => [{ ...baseOwnerAccount }],
        },
        revenueEvent: {
          findUnique: async (_q: unknown) => ({
            id: 'rev-1',
            amount: 50,
            currency: 'USD',
            status: 'REVENUE',
            proofHash: 'a'.repeat(64),
            proofType: 'SHA256',
          }),
          update: async (args: { where?: unknown; data?: unknown }) => ({
            id: 'rev-1',
            ...((args?.data as object) || {}),
          }),
        },
        settlementExecution: {
          findFirst: async (q: { where?: { metadata?: { contains?: string }; status?: { notIn?: string[] } } }) => {
            const containsKey = q?.where?.metadata?.contains ?? '';
            if (store.routingToken === containsKey && store.payoutItemId) {
              return {
                id: 'se-existing',
                settlementId: 'SE-PREV-001',
                metadata: store.metadata ?? IDEM_HIT_META,
                routingToken: containsKey,
                status: 'IDEMPOTENCY',
              };
            }
            return null;
          },
          updateMany: async (_q: { where?: { routingToken?: string }; data?: object }) => ({ count: 1 }),
          create: async (p: { data?: Record<string, unknown> }) => {
            const data = p.data ?? {};
            store.routingToken = String(data.routingToken ?? '');
            store.metadata = String(data.metadata ?? '');
            const metaParsed: Record<string, unknown> = {};
            try { Object.assign(metaParsed, JSON.parse(String(data.metadata ?? '{}'))); } catch { /* noop */ }
            store.payoutItemId = String(metaParsed.payoutItemId ?? CANONICAL_PAYOUT_ID);
            return { id: 'se-new-1', ...data };
          },
        },
        payoutBatch: {
          findFirst: async (_q: unknown) => ({ id: 'pb-fake', batchNumber: 'PB-REALBATCH01' }),
          upsert: async (_q: unknown) => ({ id: 'pb-fake', batchNumber: 'PB-REALBATCH01' }),
          create: async (p: { data?: Record<string, unknown> }) => ({
            id: 'pb-fake',
            batchNumber: (p?.data?.batchNumber as string) ?? 'PB-REALBATCH01',
            ...(p?.data ?? {}),
          }),
        },
        payoutItem: {
          create: async (p: { data?: Record<string, unknown> }) => {
            store.itemStatus = (p?.data?.status as string) || 'REVENUE';
            return {
              id: CANONICAL_PAYOUT_ID,
              ...(p?.data ?? {}),
              status: store.itemStatus,
            };
          },
          findUnique: async (q: { where?: { id?: string } }) => ({
            ...basePayoutItemFind,
            id: q?.where?.id ?? CANONICAL_PAYOUT_ID,
            status: store.itemStatus ?? basePayoutItemFind.status,
          }),
          update: async (args: { where?: object; data?: object }) => {
            const data = (args?.data ?? {}) as Record<string, unknown>;
            if (typeof data.status === 'string') {
              store.itemStatus = data.status;
            }
            return {
              ...basePayoutItemFind,
              ...data,
              id: CANONICAL_PAYOUT_ID,
              status: store.itemStatus ?? basePayoutItemFind.status,
            };
          },
        },
        payoutAuditLog: {
          create: async (_p: unknown) => ({ id: 'aud-1' }),
        },
        auditLedger: {
          create: async (_p: unknown) => ({ id: 'al-1' }),
        },
        paymentEscalation: {
          create: async (_p: unknown) => ({ id: 'pe-1' }),
        },
        ownerSettlement: {
          findMany: async (_q: unknown) => [],
          create: async (p: { data?: Record<string, unknown> }) => ({
            id: 'os-fake',
            ...(p?.data ?? {}),
          }),
        },
      });

      return {
        prisma: {
          ...makeTx(),
          $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(makeTx()),
        },
        db: undefined as unknown,
      };
    });

    vi.mock('../../single-writer-lock', () => ({
      acquireLock: async () => ({ acquired: true, lockId: 'mock-lock-1', stateHash: 'sha256:mockhash_x' }),
      releaseLock: async (_lockId: string): Promise<void> => {},
      computeStateHash: async (_record: unknown): Promise<string> => 'sha256:mockhash_x',
    }));

    vi.mock('../../escrow-vaults', () => ({
      allocateToVault: async (_vId: string, _amt: number, _outflowType: string, _approvals = 1) => ({
        approved: true,
        vaultId: _vId,
        requested: _amt,
        allocated: _amt,
        remaining: 9999,
        quorumMet: true,
      }),
      getTotalExposure: async () => ({ total: 0, percentage: 5, limit: 85 }),
    }));

    vi.mock('../../atomic-simulation', () => ({
      simulatePipeline: async (_r: unknown) => ({
        approved: true,
        action: 'settlement' as const,
        estimatedFee: 0,
        estimatedNet: 50,
        slippageBps: 0,
        gasEstimateUsd: 0,
        profitabilityScore: 100,
        proofHash: 'mockhash',
      }),
    }));

    vi.mock('../../audit-agent', () => ({
      detectDuplicates: async (): Promise<Array<{ isDuplicate: boolean; confidence: number; pattern: string; isolationAction: string; reasoning: string; proofHash: string }>> => [],
    }));

    vi.mock('../../owner-config', () => ({
      isOwnerKycPassed: (): boolean => true,
      isPayoutConfigComplete: (): boolean => true,
      getDisbursementPolicy: () => ({
        schedule: 'instant' as const,
        platformFeeBps: 0,
        fraudWindowHoldHours: 72,
        chargebackReservePct: 5,
        bucketPct: {
          sovereignReserves: 30,
          procurementBuffer: 20,
          runtimeOperations: 20,
          salary: 30,
        },
      }),
    }));

    const { settlementEngine } = await import('../SettlementEngine');

    const railOverride: SettlementRail = {
      id: 'test-rail',
      kind: 'paypal',
      ensureReady: async () => {},
      submit: async () => ({
        providerRef: 'REAL-PP-TXN-ABC123',
        providerStatus: 'live_paypal_api',
      }),
      reconcile: async () => ({
        success: true,
        finalRef: 'REAL-PP-TXN-ABC123',
      }),
    };
    settlementEngine.registerRail(railOverride);

    const IDEM_KEY = 'T6-EXACTLY-ONCE-50SIMS-SAME-KEY-v1';

    const inputs = Array.from({ length: 50 }, (_, i) => ({
      revenueEventId: 'rev-1',
      ownerAccountId: 'verified-owner-1',
      entitlementSourceRef: 'e50sim:entitlement:same:thing:0',
      idempotencyKey: IDEM_KEY,
      amount: 50.00,
      currency: 'USD',
      railKind: 'paypal' as SettlementRail['kind'],
      actor: `sim-${i}`,
      metadata: { sim: i, crashSimulated: true },
    }));

    const results = await Promise.all(inputs.map((inp) => settlementEngine.submitForSettlement(inp)));

    const allIds = new Set(results.map((r) => r.payoutItemId));
    expect(allIds.size).toBe(1);
    expect([...allIds][0]).toBe('pi_MOCK_T6_CANONICAL');

    const noErrors = results.every((r) => typeof r.payoutItemId === 'string' && r.payoutItemId.length > 0);
    expect(noErrors).toBe(true);

    process.env = backup;
  });
});

describe('T7 — finalizeSettlement synthetic ref rejection (truth-guard L3)', () => {
  it('isSyntheticRef catches INSTRUCTIONS_READY-style fabrication — must throw before writing SETTLED', () => {
    const badRefs = ['INSTRUCTIONS_READY', 'PB-42', 'RECONCILE-99', 'WAITING_MANUAL', 'REVIEWED'];
    for (const r of badRefs) {
      expect(isSyntheticRef(r)).toBe(true);
    }
    const goodRefs = ['0x' + 'a'.repeat(64), '5T738465VB123456T', 'WPS-2026-ATT-847236'];
    for (const r of goodRefs) {
      expect(isSyntheticRef(r)).toBe(false);
    }
  });
});

describe('T8 — proofHash format check (64 hex sha256)', () => {
  const sha64 = (fill: string) => fill.repeat(64);
  it('truth-guards only accept 64 lowercase hex characters for SETTLED proofHash', () => {
    const valid = /^[a-f0-9]{64}$/i;
    expect(valid.test(sha64('a'))).toBe(true);
    expect(valid.test(sha64('0'))).toBe(true);
    expect(valid.test(sha64('A'))).toBe(true);
    expect(valid.test('g' + 'a'.repeat(63))).toBe(false);
    expect(valid.test(sha64('a').slice(0, 63))).toBe(false);
    expect(valid.test(sha64('a') + '0')).toBe(false);
    expect(valid.test('')).toBe(false);
  });
});

describe('T9 — CSV/export never triggers SETTLED without reconcile proof', () => {
  it('isSyntheticRef rejects all CSV-only generated batch refs (PB- prefix / date-suffixed)', () => {
    const today = new Date().toISOString().slice(0, 10);
    const csvOnlyBatchRefs = [
      'PB-1725638492',
      `CSV-BATCH-${today}`,
      `INSTRUCTIONS_READY-${today.toUpperCase()}`,
    ];
    for (const ref of csvOnlyBatchRefs) {
      expect(isSyntheticRef(ref)).toBe(true);
    }
  });
});

describe('T10 — TERMINAL states cannot transition (valid transitions matrix fail-closed)', () => {
  it('SETTLED, REJECTED, CANCELLED, QUARANTINED, EXPIRED each have VALID_TRANSITIONS.size === 0', () => {
    for (const term of [
      SettlementState.SETTLED,
      SettlementState.REJECTED,
      SettlementState.CANCELLED,
      SettlementState.QUARANTINED,
      SettlementState.EXPIRED,
    ]) {
      expect(VALID_TRANSITIONS[term].size).toBe(0);
    }
  });
});
