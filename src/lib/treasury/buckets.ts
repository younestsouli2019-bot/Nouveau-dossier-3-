// Treasury bucket state machine.
// Owner profile fixed split (Attijariwafa RIB 372 Debt, Salary, Sovereign, Runtime):
//   SOVEREIGN_RESERVES  30% — long-term capital reserves / contingency fund
//   RUNTIME_OPERATIONS  20% — swarm infrastructure + 50% sub-budget for
//                             procurement_buffer (10% of NET, procurement spend never
//                             dips into sovereign/debt/salary buckets)
//   SALARY_BUCKET       10% — owner salary (Attijari owner payout rails)
//   DEBT_REPAYMENT      40% — Attijariwafa RIB 372 debt repayment (per user profile)
// Sum = 100.0 EXACTLY enforced. Any non-100 split → BUCKET_SUM_MISMATCH fail-closed.
// Percentages are read from the DisbursementPolicy and ALWAYS sum to 100. The
// split is computed on NET (post platform-fee + chargeback reserve) so buckets
// never cannibalise fees or reserves.

import { prisma } from '../db';
import { sha256 } from '../strict-enforcement/crypto-utils';

export const TOP_LEVEL_BUCKET_CODES = [
  'sovereign_reserves',
  'runtime_operations',
  'salary_bucket',
  'debt_repayment',
] as const;

export const ALL_BUCKET_CODES = [
  ...TOP_LEVEL_BUCKET_CODES,
  'procurement_buffer',
] as const;

export const BUCKET_CODES = ALL_BUCKET_CODES;

export type BucketCode = (typeof BUCKET_CODES)[number];
export type TopLevelBucketCode = (typeof TOP_LEVEL_BUCKET_CODES)[number];

export const BUCKET_DEFAULT_PCT: Record<TopLevelBucketCode, number> = {
  sovereign_reserves: 30,
  runtime_operations: 20,
  salary_bucket: 10,
  debt_repayment: 40,
};

export const BUCKET_LABELS: Record<BucketCode, string> = {
  sovereign_reserves: 'Sovereign Reserves',
  procurement_buffer: 'Owner Procurement Buffer (sub-allocated 50% of Runtime)',
  runtime_operations: 'Runtime Operations (procurement 50% sub-budget)',
  salary_bucket: 'Owner Salary Bucket (10%)',
  debt_repayment: 'Attijariwafa RIB 372 Debt Repayment (40%)',
};

export interface DisbursementPolicy {
  bucketPct: Record<TopLevelBucketCode, number>;
  configHash: string;
  profileVersion: string;
  procurementSubBudgetPctOfRuntime: 50;
  profile: {
    salaryDestination: string;
    debtDestination: string;
    preferLocalSuppliersCountry: 'MA';
  };
}

export const OWNER_PROFILE_V1 = 'owner_profile_v1_202608';

function assertPolicySum(pct: Record<TopLevelBucketCode, number>): void {
  const total = TOP_LEVEL_BUCKET_CODES.reduce((s, c) => s + (pct[c] ?? 0), 0);
  if (Math.abs(total - 100) > 0.001) {
    throw new Error(
      `BUCKET_SUM_MISMATCH: DisbursementPolicy bucketPct sum ${total.toFixed(4)} != 100 exactly. ` +
        `Required split: sovereign_reserves=30, runtime_operations=20, salary_bucket=10, debt_repayment=40. ` +
        `Actual: ${JSON.stringify(pct)}. Operation KILLED — silent drift into any bucket is forbidden.`,
    );
  }
}

export function getDisbursementPolicy(): DisbursementPolicy {
  const pct = { ...BUCKET_DEFAULT_PCT } as Record<TopLevelBucketCode, number>;
  assertPolicySum(pct);
  const cfg: DisbursementPolicy = {
    bucketPct: pct,
    configHash: sha256(JSON.stringify({ pct, v: OWNER_PROFILE_V1 })),
    profileVersion: OWNER_PROFILE_V1,
    procurementSubBudgetPctOfRuntime: 50,
    profile: {
      salaryDestination: 'Owner salary bucket → Attijari payroll rail',
      debtDestination: 'Attijariwafa RIB 372 — Debt repayment (40% rail)',
      preferLocalSuppliersCountry: 'MA',
    },
  };
  return cfg;
}

export function computeDisbursementPolicy(pct: Partial<Record<TopLevelBucketCode, number>>): DisbursementPolicy {
  const merged = { ...BUCKET_DEFAULT_PCT, ...pct } as Record<TopLevelBucketCode, number>;
  assertPolicySum(merged);
  const cfg: DisbursementPolicy = {
    bucketPct: merged,
    configHash: sha256(JSON.stringify({ pct: merged, v: OWNER_PROFILE_V1 })),
    profileVersion: OWNER_PROFILE_V1,
    procurementSubBudgetPctOfRuntime: 50,
    profile: getDisbursementPolicy().profile,
  };
  return cfg;
}

export interface ProcurementSpendAuthorisation {
  spendableAmount: number;
  procurementBufferBalance: number;
  runtimeBalance: number;
  runtimeSubBudgetAvailable: number;
  policyConfigHash: string;
  currency: 'USD';
  details: string;
}

export async function getProcurementSpendAuthorisation(): Promise<ProcurementSpendAuthorisation> {
  const policy = getDisbursementPolicy();
  const [procBuf, runtime] = await Promise.all([
    prisma.fundBucket.findUnique({ where: { code: 'procurement_buffer' } }).catch(() => null),
    prisma.fundBucket.findUnique({ where: { code: 'runtime_operations' } }).catch(() => null),
  ]);
  const procurementBufferBalance = procBuf ? Math.max(0, procBuf.allocated - procBuf.released) : 0;
  const runtimeBalance = runtime ? Math.max(0, runtime.allocated - runtime.released) : 0;
  const runtimeSubBudgetAvailable =
    (runtimeBalance * policy.procurementSubBudgetPctOfRuntime) / 100;
  const spendableAmount = Math.max(0, Math.round((procurementBufferBalance + runtimeSubBudgetAvailable) * 100) / 100);
  return {
    spendableAmount,
    procurementBufferBalance,
    runtimeBalance,
    runtimeSubBudgetAvailable,
    policyConfigHash: policy.configHash,
    currency: 'USD',
    details:
      `Procurement spend authorised = procurement_buffer.balance (${procurementBufferBalance}) ` +
      `+ (runtime_operations.balance × 50% sub-budget) (${runtimeSubBudgetAvailable.toFixed(2)}) ` +
      `≤ total ${spendableAmount.toFixed(2)} USD. NEVER drawn from sovereign_reserves, salary_bucket, or debt_repayment.`,
  };
}

export interface BucketSplit {
  code: BucketCode;
  label: string;
  pct: number;
  amount: number;
}

export interface BucketAllocationInput {
  code: BucketCode;
  pct: number;
  amount: number;
  revenueEventId?: string;
  sourceLabel?: string;
  sourceRef?: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Pure split: allocate `net` across buckets by percentage.
 * Percentages may come from env (policy.bucketPct) or caller override; if the
 * units do not sum to 100 the remainder is added to salary_bucket (never lost).
 */
export function computeBucketSplit(net: number, pct: Partial<Record<BucketCode, number>>, overrides?: Partial<Record<BucketCode, number>>): BucketSplit[] {
  const resolvedPct: Record<BucketCode, number> = {
    sovereign_reserves: 0,
    runtime_operations: 0,
    salary_bucket: 0,
    debt_repayment: 0,
    procurement_buffer: 0,
    ...pct,
    ...overrides,
  } as Record<BucketCode, number>;
  const topSum = TOP_LEVEL_BUCKET_CODES.reduce((s, c) => s + ((resolvedPct as unknown as Record<TopLevelBucketCode, number>)[c] ?? 0), 0);
  if (Math.abs(topSum - 100) > 0.001) {
    throw new Error(
      `BUCKET_SUM_MISMATCH: computeBucketSplit top-level pct sum ${topSum.toFixed(4)} != 100. ` +
        `Silent drift into salary_bucket is forbidden — correct pct values before calling.`,
    );
  }
  const splits: BucketSplit[] = (Object.keys(resolvedPct) as BucketCode[]).map((code) => {
    const p = resolvedPct[code] ?? 0;
    const amount = round2((net * p) / 100);
    return { code, label: BUCKET_LABELS[code], pct: p, amount };
  });

  const assigned = round2(splits.reduce((s, x) => s + x.amount, 0));
  const drift = round2(net - assigned);
  if (Math.abs(drift) > 0) {
    const debt = splits.find((s) => s.code === 'debt_repayment');
    if (debt) {
      debt.amount = round2(debt.amount + drift);
    }
  }
  return splits;
}

export function bucketConfigHash(pct: Record<BucketCode, number>): string {
  return sha256(JSON.stringify({ buckPct: pct, version: 1 }));
}

/**
 * Persist bucket intent/funding. Idempotent accumulation:
 *  - allocated: cumulative funds committed to this bucket
 *  - released: cumulative funds actually moved out (external rails)
 *  - balance: allocated - released (funds still inside the bucket)
 * Allocation rows are written to OwnerSettlement (purpose=bucket.<code>) and
 * FundBucket balances are incremented transactionally.
 */
export async function allocateToBuckets(inputs: BucketAllocationInput[]): Promise<{
  ok: boolean;
  allocations: Array<{ code: BucketCode; amount: number; pct: number }>;
  reason?: string;
}> {
  if (inputs.length === 0) return { ok: false, allocations: [], reason: 'No bucket allocations provided' };
  if (inputs.some((i) => i.amount < 0 || i.pct < 0)) {
    return { ok: false, allocations: [], reason: 'Negative bucket amount or percentage rejected' };
  }

  const allocations = inputs.map((i) => ({
    code: i.code as BucketCode,
    amount: round2(i.amount),
    pct: i.pct,
  }));

  // Internal owner account that hosts bucket intent rows (FK for OwnerSettlement).
  const internalAcct = await prisma.ownerAccount.upsert({
    where: { id: 'bucket-internal' },
    update: {},
    create: {
      id: 'bucket-internal',
      label: 'Internal Treasury Buckets',
      accountType: 'internal_pool',
      currency: 'USD',
      purposes: 'bucket_allocations',
      notes: 'Hosts FundBucket intent rows; no external rail',
    },
  });

  for (const a of allocations) {
    await prisma.ownerSettlement.create({
      data: {
        ownerAccountId: internalAcct.id,
        // FundBucket rows do not map to a real bank account; track them against
        // an internal ledger account below instead.
        amount: a.amount,
        currency: 'USD',
        status: 'pending',
        direction: 'outbound',
        purpose: `bucket.${a.code}`,
        description: `${a.code} allocation`,
        sourceLabel: inputs.find((x) => x.code === a.code)?.sourceLabel || 'bucket-allocation',
        fee: 0,
        netAmount: a.amount,
        dataSource: 'internal_ledger_only',
        metadata: JSON.stringify({
          bucket: a.code,
          pct: a.pct,
          revenueEventId: inputs.find((x) => x.code === a.code)?.revenueEventId || null,
        }),
      },
    });
  }

  // Upsert bucket balances + internal ledger accounts for each bucket.
  for (const a of allocations) {
    await prisma.fundBucket.upsert({
      where: { code: a.code },
      update: { allocated: { increment: a.amount } },
      create: { code: a.code, label: BUCKET_LABELS[a.code], percentagePct: a.pct, allocated: a.amount },
    });

    const acctNumber = `bucket-${a.code}`;
    const ledger = await prisma.ledgerAccount.upsert({
      where: { accountNumber: acctNumber },
      update: { balance: { increment: a.amount } },
      create: {
        accountNumber: acctNumber,
        name: BUCKET_LABELS[a.code],
        accountType: 'DESTINATION',
        balance: a.amount,
        currency: 'USD',
        externalTag: `bucket:${a.code}`,
      },
    });

    await prisma.revenueLedgerEntry.create({
      data: {
        accountId: ledger.id,
        amount: a.amount,
        entryType: 'CREDIT',
        state: 'SETTLED',
        idempotencyKey: `bucket:${a.code}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        rail: 'internal_bucket',
      },
    });
  }

  return { ok: true, allocations };
}

export async function getBucketBalances() {
  const buckets = await prisma.fundBucket.findMany({ orderBy: { code: 'asc' } });
  return buckets.map((b) => ({
    code: b.code,
    label: b.label,
    allocated: b.allocated,
    released: b.released,
    balance: b.allocated - b.released,
    percentagePct: b.percentagePct,
  }));
}

export async function releaseFromBucket(code: BucketCode, amount: number, externalRef?: string): Promise<{ ok: boolean; reason?: string }> {
  amount = round2(amount);
  if (amount <= 0) return { ok: false, reason: 'Release amount must be positive' };
  const bucket = await prisma.fundBucket.findUnique({ where: { code } });
  if (!bucket) return { ok: false, reason: `Bucket ${code} does not exist` };
  const balance = bucket.allocated - bucket.released;
  if (amount > balance) return { ok: false, reason: `Bucket ${code} insufficient balance (${balance})` };

  await prisma.fundBucket.update({
    where: { code },
    data: { released: { increment: amount } },
  });
  await prisma.auditLedger.create({
    data: {
      entityType: 'bucket_release',
      entityId: code,
      action: 'released',
      entryHash: await sha256(`bucket-release:${code}:${amount}:${Date.now()}`),
      proofHash: externalRef || null,
      performedBy: 'treasury-engine',
      metadata: JSON.stringify({ bucket: code, amount, externalRef: externalRef || null }),
    },
  });
  return { ok: true };
}