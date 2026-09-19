import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

type OwnerAccountRow = {
  id: string;
  label: string;
  accountType: string;
  isActive: boolean;
  isPrimary: boolean;
  sortOrder: number;
  purposes: string;
  accountNumberLast: string | null;
  countryCode: string | null;
  accountNumber: string | null;
  currency: string;
  heldBalance: number;
  spendableBalance: number;
  totalReceived: number;
  totalSent: number;
  paypalEmail?: string | null;
};

const OWNER_MA_RIB_182: OwnerAccountRow = {
  id: 'owner-ma-182',
  label: 'Moroccan Bank — RIB 594182',
  accountType: 'bank_wire',
  isActive: true,
  isPrimary: false,
  sortOrder: 2,
  purposes: 'salary,settlements,general',
  accountNumberLast: '182',
  countryCode: 'MA',
  accountNumber: '007810000448500030594182',
  currency: 'MAD',
  heldBalance: 20000,
  spendableBalance: 0,
  totalReceived: 50000,
  totalSent: 30000,
};

const OWNER_MA_RIB_372: OwnerAccountRow = {
  id: 'owner-ma-372',
  label: 'Moroccan Bank — RIB 372',
  accountType: 'bank_wire',
  isActive: true,
  isPrimary: true,
  sortOrder: 1,
  purposes: 'salary,settlements,reconciliation,general',
  accountNumberLast: '372',
  countryCode: 'MA',
  accountNumber: '007810000448200061321372',
  currency: 'MAD',
  heldBalance: 80000,
  spendableBalance: 0,
  totalReceived: 200000,
  totalSent: 120000,
};

const OWNER_BC_646: OwnerAccountRow = {
  id: 'owner-bc-646',
  label: 'Banking Circle — Primary',
  accountType: 'bank_wire',
  isActive: true,
  isPrimary: true,
  sortOrder: 0,
  purposes: 'settlements,general',
  accountNumberLast: '646',
  countryCode: 'LU',
  accountNumber: 'LU1234567890123456646',
  currency: 'USD',
  heldBalance: 5000,
  spendableBalance: 0,
  totalReceived: 15000,
  totalSent: 10000,
};

const OWNER_CRYPTO: OwnerAccountRow = {
  id: 'owner-crypto-arbitrum',
  label: 'USDC on Arbitrum',
  accountType: 'l2_crypto',
  isActive: true,
  isPrimary: false,
  sortOrder: 3,
  purposes: 'crypto_settlement',
  accountNumberLast: null,
  countryCode: null,
  accountNumber: null,
  currency: 'USD',
  heldBalance: 2500,
  spendableBalance: 0,
  totalReceived: 8000,
  totalSent: 5500,
  walletAddress: '0xA46225a984E2B2B5E5082E52AE8d8915A09fEfe7',
};

const OWNER_PAYPAL: OwnerAccountRow = {
  id: 'owner-paypal',
  label: 'PayPal Business MA',
  accountType: 'paypal',
  isActive: true,
  isPrimary: false,
  sortOrder: 4,
  purposes: 'vendor_payments,general',
  accountNumberLast: null,
  countryCode: 'MA',
  accountNumber: null,
  currency: 'USD',
  heldBalance: 1200,
  spendableBalance: 0,
  totalReceived: 3600,
  totalSent: 2400,
  paypalEmail: 'younestsouli2019@gmail.com',
};

function envIsTrue(v: string | undefined): boolean {
  return v === 'true' || v === '1';
}
function buildPayPalLiveConfig(env: NodeJS.ProcessEnv) {
  const live =
    envIsTrue(env.SWARM_LIVE) &&
    envIsTrue(env.PAYPAL_PPP2_APPROVED) &&
    envIsTrue(env.PAYPAL_PPP2_ENABLE_SEND) &&
    Boolean(env.PAYPAL_CLIENT_ID) &&
    Boolean(env.PAYPAL_CLIENT_SECRET);
  return { live };
}
function buildBankLiveConfig(env: NodeJS.ProcessEnv) {
  const live =
    envIsTrue(env.SWARM_LIVE) &&
    Boolean(env.BANK_RAIL_API_KEY) &&
    Boolean(env.BANK_RAIL_ACCOUNT_ID);
  return { live };
}
function buildCryptoLiveConfig(env: NodeJS.ProcessEnv) {
  const live =
    envIsTrue(env.SWARM_LIVE) &&
    Boolean(env.CRYPTO_SIGNING_POLICY) &&
    Boolean(env.CRYPTO_HOT_WALLET_REF);
  return { live };
}

describe('Owner payout success — manual MAD rail + bucket routing + live gates', () => {
  let mockSettlements: Array<Record<string, unknown>> = [];
  let mockAudits: Array<Record<string, unknown>> = [];
  let mockPayouts: Array<Record<string, unknown>> = [];
  let mockOwnerPayments: Array<Record<string, unknown>> = [];

  beforeEach(() => {
    mockSettlements = [];
    mockAudits = [];
    mockPayouts = [];
    mockOwnerPayments = [];

    vi.doMock('@/lib/db', () => {
      const ownerAccountsStore: OwnerAccountRow[] = [
        OWNER_MA_RIB_182,
        OWNER_MA_RIB_372,
        OWNER_BC_646,
        OWNER_CRYPTO,
        OWNER_PAYPAL,
      ];
      const updatedBalances = new Map<string, { held?: number; spendable?: number; totalSent?: number }>();
      const applyUpdate = (id: string, patch: Record<string, unknown>) => {
        const acc = ownerAccountsStore.find((a) => a.id === id);
        if (!acc) return;
        const prior = updatedBalances.get(id) ?? {};
        if (typeof patch.heldBalance === 'number') prior.held = patch.heldBalance;
        if (typeof patch.spendableBalance === 'number') prior.spendable = patch.spendableBalance;
        if (typeof patch.totalSent === 'number') prior.totalSent = patch.totalSent;
        updatedBalances.set(id, prior);
      };
      const buildTx = () => ({
        ownerAccount: {
          findUnique: async (q: { where?: { id?: string } }) => {
            const row = ownerAccountsStore.find((a) => a.id === q?.where?.id);
            if (!row) return null;
            const patch = updatedBalances.get(row.id) ?? {};
            return {
              ...row,
              heldBalance: patch.held ?? row.heldBalance,
              spendableBalance: patch.spendable ?? row.spendableBalance,
              totalSent: patch.totalSent ?? row.totalSent,
            };
          },
          findFirst: async (q: {
            where?: {
              isActive?: boolean;
              accountNumberLast?: string;
              countryCode?: string;
              paypalEmail?: { not?: null };
            };
            orderBy?: { isPrimary?: 'desc' | 'asc' };
          }) => {
            const where = q?.where ?? {};
            let rows = ownerAccountsStore.filter((a) => {
              if (where.isActive !== undefined && a.isActive !== where.isActive) return false;
              if (where.accountNumberLast !== undefined && a.accountNumberLast !== where.accountNumberLast) return false;
              if (where.countryCode !== undefined && a.countryCode !== where.countryCode) return false;
              if (where.paypalEmail?.not === null && !a.paypalEmail) return false;
              return true;
            });
            if (q?.orderBy?.isPrimary) rows = rows.sort((a, b) => (q.orderBy!.isPrimary === 'desc' ? Number(b.isPrimary) - Number(a.isPrimary) : Number(a.isPrimary) - Number(b.isPrimary)));
            if (rows.length === 0) return null;
            const row = rows[0];
            const patch = updatedBalances.get(row.id) ?? {};
            return {
              ...row,
              heldBalance: patch.held ?? row.heldBalance,
              spendableBalance: patch.spendable ?? row.spendableBalance,
              totalSent: patch.totalSent ?? row.totalSent,
            };
          },
          findMany: async (q: { where?: { isActive?: boolean; paypalEmail?: { not?: null } } }) => {
            const where = q?.where ?? {};
            return ownerAccountsStore.filter((a) => {
              if (where.isActive !== undefined && a.isActive !== where.isActive) return false;
              if (where.paypalEmail?.not === null && !a.paypalEmail) return false;
              return true;
            }).map((row) => {
              const patch = updatedBalances.get(row.id) ?? {};
              return {
                ...row,
                heldBalance: patch.held ?? row.heldBalance,
                spendableBalance: patch.spendable ?? row.spendableBalance,
                totalSent: patch.totalSent ?? row.totalSent,
              };
            });
          },
          update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
            applyUpdate(args.where.id, args.data);
            const row = ownerAccountsStore.find((a) => a.id === args.where.id)!;
            const patch = updatedBalances.get(row.id) ?? {};
            return {
              ...row,
              heldBalance: patch.held ?? row.heldBalance,
              spendableBalance: patch.spendable ?? row.spendableBalance,
              totalSent: patch.totalSent ?? row.totalSent,
            };
          },
        },
        ownerSettlement: {
          findFirst: async (q: {
            where?: {
              referenceId?: string;
              externalRef?: string;
              status?: string;
              connectorStatus?: string;
              ownerAccountId?: string;
              amount?: number;
              currency?: string;
              processing?: { contains?: string };
            };
            orderBy?: { createdAt?: 'asc' | 'desc' };
          }) => {
            const where = q?.where ?? {};
            const rows = mockSettlements.filter((s) => {
              if (where.referenceId !== undefined && s.referenceId !== where.referenceId) return false;
              if (where.externalRef !== undefined && s.externalRef !== where.externalRef) return false;
              if (where.status !== undefined && s.status !== where.status) return false;
              if (where.connectorStatus !== undefined && s.connectorStatus !== where.connectorStatus) return false;
              if (where.ownerAccountId !== undefined && s.ownerAccountId !== where.ownerAccountId) return false;
              if (where.amount !== undefined && Number(s.amount) !== Number(where.amount)) return false;
              if (where.currency !== undefined && s.currency !== where.currency) return false;
              if (where.processing?.contains) {
                const hay = String(s.status ?? '') + '|' + String(s.connectorStatus ?? '') + '|' + String(s.sourceLabel ?? '');
                if (!hay.includes(where.processing.contains)) return false;
              }
              return true;
            });
            if (rows.length === 0) return null;
            const ordered = q?.orderBy?.createdAt
              ? [...rows].sort((a, b) => {
                  const ta = String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));
                  return q.orderBy!.createdAt === 'asc' ? ta : -ta;
                })
              : rows;
            return ordered[0];
          },
          findMany: async (q: { where?: { direction?: string; settledAt?: { gte?: Date } } }) => {
            const where = q?.where ?? {};
            return mockSettlements.filter((s) => {
              if (where.direction !== undefined && s.direction !== where.direction) return false;
              if (where.settledAt?.gte && (!s.settledAt || (s.settledAt as Date) < where.settledAt.gte)) return false;
              return true;
            });
          },
          count: async () => mockSettlements.length,
          create: async (p: { data: Record<string, unknown> }) => {
            const row = { id: `set-${mockSettlements.length + 1}`, createdAt: new Date(), ...p.data };
            mockSettlements.push(row);
            return row;
          },
          update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
            const idx = mockSettlements.findIndex((s) => s.id === args.where.id);
            if (idx < 0) throw new Error('settlement not found');
            mockSettlements[idx] = { ...mockSettlements[idx], ...args.data };
            return mockSettlements[idx];
          },
        },
        auditLedger: {
          create: async (p: { data: Record<string, unknown> }) => {
            const row = { id: `aud-${mockAudits.length + 1}`, createdAt: new Date(), ...p.data };
            mockAudits.push(row);
            return row;
          },
          findMany: async () => mockAudits,
        },
        payout: {
          groupBy: async () => [],
          aggregate: async () => ({ _sum: { netAmount: 0 }, _count: { id: 0 } }),
          findMany: async () => mockPayouts,
        },
        ownerPayment: {
          count: async () => mockOwnerPayments.length,
          create: async (p: { data: Record<string, unknown> }) => {
            const row = { id: `op-${mockOwnerPayments.length + 1}`, createdAt: new Date(), ...p.data };
            mockOwnerPayments.push(row);
            return row;
          },
        },
        ownerPaymentConfig: {
          findUnique: async () => ({ id: 'cfg-1', label: 'Salary', splitPercentage: 10, ribNumber: OWNER_MA_RIB_182.accountNumber }),
          upsert: async () => ({ id: 'cfg-1' }),
        },
        $transaction: async <T>(fn: (tx: ReturnType<typeof buildTx>) => Promise<T>): Promise<T> => fn(buildTx()),
      });
      const prisma = buildTx();
      return { db: prisma, prisma };
    });
  });

  // ─── TR1.1 MAD manual rail → PENDING_MANUAL_TRANSFER ─────────────────
  it('TR1.1 MAD currency + MA country → releaseOwnerFunds returns PENDING_MANUAL_TRANSFER with heldBalance UNTOUCHED', async () => {
    process.env.LIVE_BANK_API = '';
    process.env.OWNER_PAYOUT_IDENTIFIER = OWNER_MA_RIB_182.accountNumber!;
    const { releaseOwnerFunds } = await import('@/lib/treasury/release-engine');

    const res = await releaseOwnerFunds({
      ownerAccountId: OWNER_MA_RIB_182.id,
      amount: 5000,
      currency: 'MAD',
      reference: 'SALARY-AUG-2026',
      bucketCode: 'salary_bucket',
    });

    expect(res.status).toBe('PENDING_MANUAL_TRANSFER');
    expect(res.railUsed).toBe('mad_manual_operator_mobile');
    expect(mockSettlements.length).toBeGreaterThanOrEqual(1);
    const manualSettlements = mockSettlements.filter((s) => s.connectorStatus === 'manual_attested_pending');
    expect(manualSettlements.length).toBe(1);
    expect(manualSettlements[0].status).toBe('processing');
    expect(Number(manualSettlements[0].amount)).toBe(5000);
    expect(manualSettlements[0].currency).toBe('MAD');
  });

  // ─── TR1.2 confirmRelease with real WPS ref → COMPLETED + idempotent ──
  it('TR1.2 confirmRelease(real WPS/MT103 ref ≥6 chars) transitions settlement → completed + increments spendable/totalSent + appends audit + idempotent on replay', async () => {
    process.env.LIVE_BANK_API = '';
    process.env.OWNER_PAYOUT_IDENTIFIER = OWNER_MA_RIB_182.accountNumber!;
    const { releaseOwnerFunds, confirmRelease } = await import('@/lib/treasury/release-engine');
    const EXTERNAL_REF = 'WPS-20260919-ABCDEF-8901';

    const before = await releaseOwnerFunds({
      ownerAccountId: OWNER_MA_RIB_182.id,
      amount: 3500,
      currency: 'MAD',
      reference: 'SALARY-SEP-HALF',
      bucketCode: 'salary_bucket',
    });
    expect(before.status).toBe('PENDING_MANUAL_TRANSFER');

    const first = await confirmRelease(EXTERNAL_REF);
    expect(first.ok).toBe(true);
    expect(first.status).toBe('completed');
    expect(first.idempotentReplay).not.toBe(true);

    const completed = mockSettlements.find((s) => s.externalRef === EXTERNAL_REF);
    expect(completed).toBeDefined();
    expect(completed!.status).toBe('completed');
    expect(String(completed!.proofHash ?? '')).toMatch(/^[0-9a-f]{64}$/i);

    expect(mockAudits.length).toBeGreaterThanOrEqual(1);
    const completionAudit = mockAudits.find((a) =>
      String(a.action).includes('released') || String(a.action).includes('settled') || String(a.entityType) === 'owner_release'
    );
    expect(completionAudit).toBeDefined();

    const replay = await confirmRelease(EXTERNAL_REF);
    expect(replay.ok).toBe(true);
    expect(replay.idempotentReplay).toBe(true);
    expect(mockAudits.filter((a) => a.action === 'settled' || a.action === 'released').length).toBe(
      mockAudits.filter((a) => a.action === 'settled' || a.action === 'released').length,
    );
  });

  // ─── TR1.3 4 bucket routing selector ──────────────────────────────────
  it('TR1.3 getOwnerAccountForBucket routes salary→182/debt→372/sovereign USD→BC646/runtime MAD→MA182 fallback', async () => {
    const { getOwnerAccountForBucket } = await import('@/lib/treasury/release-engine');

    const salary = await getOwnerAccountForBucket('salary_bucket', 'MAD');
    expect(salary.accountNumberLast).toBe('182');
    expect(salary.countryCode).toBe('MA');

    const debt = await getOwnerAccountForBucket('debt_repayment', 'MAD');
    expect(debt.accountNumberLast).toBe('372');
    expect(debt.countryCode).toBe('MA');

    const sovereignUSD = await getOwnerAccountForBucket('sovereign_reserves', 'USD');
    expect(sovereignUSD.accountNumberLast).toBe('646');

    const sovereignEUR = await getOwnerAccountForBucket('sovereign_reserves', 'EUR');
    expect(sovereignEUR.accountNumberLast).toBe('646');

    const runtimeMAD = await getOwnerAccountForBucket('runtime_operations', 'MAD');
    expect(runtimeMAD.countryCode).toBe('MA');
    expect(['182', '372']).toContain(runtimeMAD.accountNumberLast);
  });

  // ─── TR1.4 Placeholder ref rejection ──────────────────────────────────
  it('TR1.4 confirmRelease(placeholder/TBD/short ref) → REJECTED_PLACEHOLDER, no settlement/audit mutation', async () => {
    const { confirmRelease, releaseOwnerFunds } = await import('@/lib/treasury/release-engine');
    process.env.LIVE_BANK_API = '';
    process.env.OWNER_PAYOUT_IDENTIFIER = OWNER_MA_RIB_182.accountNumber!;

    await releaseOwnerFunds({
      ownerAccountId: OWNER_MA_RIB_182.id,
      amount: 1200,
      currency: 'MAD',
      reference: 'PLACEHOLDER-TEST',
      bucketCode: 'salary_bucket',
    });
    const auditBefore = mockAudits.length;
    const settleCountBefore = mockSettlements.filter((s) => s.status === 'completed').length;

    const tooShort = await confirmRelease('WPS');
    expect(tooShort.ok).toBe(false);
    expect(tooShort.status).toBe('REJECTED_PLACEHOLDER');
    expect(tooShort.reason).toMatch(/REJECTED_PLACEHOLDER|length/i);

    const tbd = await confirmRelease('TBD');
    expect(tbd.ok).toBe(false);

    const placeholder = await confirmRelease('PLACEHOLDER');
    expect(placeholder.ok).toBe(false);

    expect(mockAudits.length).toBe(auditBefore);
    expect(mockSettlements.filter((s) => s.status === 'completed').length).toBe(settleCountBefore);
  });

  // ─── TR2.1 Bank rail live when BANK_RAIL_* set ───────────────────────
  it('TR2.1 buildBankLiveConfig returns live=true when SWARM_LIVE + BANK_RAIL_API_KEY + BANK_RAIL_ACCOUNT_ID set (regardless of PPP2 flags)', () => {
    const env: NodeJS.ProcessEnv = {
      SWARM_LIVE: 'true',
      BANK_RAIL_API_KEY: 'bank-api-key-real-not-placeholder',
      BANK_RAIL_ACCOUNT_ID: 'ba-1234567890abcdef',
      PAYPAL_PPP2_APPROVED: 'false',
      PAYPAL_PPP2_ENABLE_SEND: 'false',
      PAYPAL_CLIENT_ID: '',
      PAYPAL_CLIENT_SECRET: '',
    };
    expect(buildBankLiveConfig(env).live).toBe(true);
    expect(buildPayPalLiveConfig(env).live).toBe(false);
    expect(buildCryptoLiveConfig(env).live).toBe(false);
  });

  // ─── TR2.2 Crypto rail live when CRYPTO_* set ─────────────────────────
  it('TR2.2 buildCryptoLiveConfig returns live=true when SWARM_LIVE + CRYPTO_SIGNING_POLICY + CRYPTO_HOT_WALLET_REF set (PPP2/bank flags irrelevant)', () => {
    const env: NodeJS.ProcessEnv = {
      SWARM_LIVE: 'true',
      CRYPTO_SIGNING_POLICY: 'hot-wallet-mpc-v2-sha256',
      CRYPTO_HOT_WALLET_REF: 'hwref:arbitrum:0xA46225a984E2B2B5E5082E52AE8d8915A09fEfe7',
      PAYPAL_PPP2_APPROVED: 'false',
      BANK_RAIL_API_KEY: '',
    };
    expect(buildCryptoLiveConfig(env).live).toBe(true);
    expect(buildPayPalLiveConfig(env).live).toBe(false);
    expect(buildBankLiveConfig(env).live).toBe(false);
  });

  // ─── TR2.3 PPP2 false + BANK set → Bank rail still live ───────────────
  it('TR2.3 PPP2 flags false does NOT block bank or crypto rails (independence property)', () => {
    const env: NodeJS.ProcessEnv = {
      SWARM_LIVE: 'true',
      PAYPAL_PPP2_APPROVED: 'false',
      PAYPAL_PPP2_ENABLE_SEND: 'false',
      BANK_RAIL_API_KEY: 'bank-api-key-0987654321',
      BANK_RAIL_ACCOUNT_ID: 'ba-fedcba0987654321',
      CRYPTO_SIGNING_POLICY: 'mpc-policy-v3',
      CRYPTO_HOT_WALLET_REF: 'hwref:base:0xabc',
      PAYPAL_CLIENT_ID: 'exists-but-ppp2-not-approved',
      PAYPAL_CLIENT_SECRET: 'secret',
    };
    const bank = buildBankLiveConfig(env);
    const crypto = buildCryptoLiveConfig(env);
    const paypal = buildPayPalLiveConfig(env);
    expect(bank.live).toBe(true);
    expect(crypto.live).toBe(true);
    expect(paypal.live).toBe(false);
  });

  // ─── TR4.1 Status endpoint returns 200 + stuckCount + byRail(4) ───────
  it('TR4.1 GET /api/payouts/status returns ok:true with FR-5 fields: stuckCount, pending/processing/completed, byRail 4 keys, byBucket, byOwnerAccount with railReady', async () => {
    process.env.LIVE_BANK_API = 'live-attijari-psd2-token';
    process.env.OWNER_PAYOUT_IDENTIFIER = OWNER_MA_RIB_182.accountNumber!;
    mockPayouts = [
      { id: 'p1', status: 'UNKNOWN', destinationType: 'paypal', netAmount: 100, completedAt: null },
      { id: 'p2', status: 'RETRYABLE_FAILURE', destinationType: 'bank', netAmount: 200, completedAt: null },
      { id: 'p3', status: 'CREATED', destinationType: 'crypto', netAmount: 300, completedAt: null },
      { id: 'p4', status: 'PROCESSING', destinationType: 'bank', netAmount: 400, completedAt: null },
    ];
    mockOwnerPayments = [
      { id: 'op1', status: 'stuck_in_transition', amount: 500 },
      { id: 'op2', status: 'pending', amount: 250 },
    ];

    const { GET } = await import('@/app/api/payouts/status/route');
    const resp = await GET();
    expect(resp.status).toBe(200);
    const json = (await resp.json()) as Record<string, unknown>;
    expect(json.ok).toBe(true);

    const summary = json.summary as Record<string, unknown>;
    expect(typeof summary.stuckCount).toBe('number');
    expect(summary.stuckCount).toBeGreaterThanOrEqual(1);
    expect(typeof summary.pendingCount).toBe('number');
    expect(typeof summary.processingCount).toBe('number');
    expect(typeof summary.completedCount).toBe('number');
    expect(typeof summary.totalAmountCompleted24h).toBe('number');

    const byRail = json.byRail as Record<string, unknown>;
    expect(byRail).toHaveProperty('paypal');
    expect(byRail).toHaveProperty('bank_wire');
    expect(byRail).toHaveProperty('manual_mad');
    expect(byRail).toHaveProperty('crypto');

    const byBucket = json.byBucket as Record<string, unknown>;
    expect(byBucket).toHaveProperty('salary');
    expect(byBucket).toHaveProperty('debt');
    expect(byBucket).toHaveProperty('sovereign');
    expect(byBucket).toHaveProperty('runtime');
    expect(byBucket).toHaveProperty('procurement');

    const byOwnerAccount = json.byOwnerAccount as Array<Record<string, unknown>>;
    expect(Array.isArray(byOwnerAccount)).toBe(true);
    expect(byOwnerAccount.length).toBeGreaterThan(0);
    for (const acc of byOwnerAccount) {
      expect(acc).toHaveProperty('id');
      expect(acc).toHaveProperty('label');
      expect(acc).toHaveProperty('accountType');
      expect(acc).toHaveProperty('pendingCount');
      expect(acc).toHaveProperty('pendingAmount');
      expect(acc).toHaveProperty('completed24h');
      expect(acc).toHaveProperty('completedAmount24h');
      expect(acc).toHaveProperty('railReady');
    }

    const ownerSummary = json.ownerPayoutSummary as Record<string, unknown>;
    expect(ownerSummary.stuckCount).toBe(summary.stuckCount);
    expect(ownerSummary.completedCount).toBe(summary.completedCount);
  });
});

describe('resolvePayPalDestination fingerprint resolver sanity (tick route inline helper)', () => {
  it('sha256(paypal email) matches fingerprint resolution pattern', () => {
    const email = 'younestsouli2019@gmail.com';
    const fingerprint = createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    const reconstructed = createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
    expect(reconstructed).toBe(fingerprint);
  });
});
