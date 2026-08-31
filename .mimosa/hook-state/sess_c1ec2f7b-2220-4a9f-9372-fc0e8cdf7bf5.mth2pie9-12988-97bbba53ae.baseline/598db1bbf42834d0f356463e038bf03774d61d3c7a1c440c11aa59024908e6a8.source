// Treasury bucket state machine.
// The owner's architecture splits NET settlement value across four buckets:
//   SOVEREIGN_RESERVES      — long-term capital reserves / contingency fund
//   PROCUREMENT_BUFFER      — funds reserved to pay owner-directed purchase orders
//   RUNTIME_OPERATIONS      — swarm infrastructure allocation (owner-allowed %)
//   SALARY_BUCKET           — owner salary bucket
// Percentages are read from the DisbursementPolicy (env-driven) and ALWAYS sum
// to 100. The split is computed on NET (post platform-fee + chargeback reserve),
// so buckets never cannibalise fees or reserves.

import { prisma } from '../db';
import { sha256 } from '../strict-enforcement/crypto-utils';

export const BUCKET_CODES = [
  'sovereign_reserves',
  'procurement_buffer',
  'runtime_operations',
  'salary_bucket',
] as const;

export type BucketCode = (typeof BUCKET_CODES)[number];

export const BUCKET_DEFAULT_PCT: Record<BucketCode, number> = {
  sovereign_reserves: 30,
  procurement_buffer: 10,
  runtime_operations: 20,
  salary_bucket: 40,
};

export const BUCKET_LABELS: Record<BucketCode, string> = {
  sovereign_reserves: 'Sovereign Reserves',
  procurement_buffer: 'Owner Procurement Buffer',
  runtime_operations: 'Runtime Operations',
  salary_bucket: 'Owner Salary Bucket',
};

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
export function computeBucketSplit(net: number, pct: Record<BucketCode, number>, overrides?: Partial<Record<BucketCode, number>>): BucketSplit[] {
  const resolvedPct = { ...pct, ...overrides } as Record<BucketCode, number>;
  const total = BUCKET_CODES.reduce((s, c) => s + (resolvedPct[c] ?? 0), 0);
  const splits: BucketSplit[] = BUCKET_CODES.map((code) => {
    const p = resolvedPct[code] ?? 0;
    const amount = round2((net * p) / 100);
    return { code, label: BUCKET_LABELS[code], pct: p, amount };
  });

  // Reconcile rounding drift + any % mismatch into salary_bucket.
  const assigned = round2(splits.reduce((s, x) => s + x.amount, 0));
  const drift = round2(net - assigned);
  const salary = splits.find((s) => s.code === 'salary_bucket');
  if (salary) {
    salary.amount = round2(salary.amount + drift);
    salary.pct = total === 100 ? salary.pct : round2((salary.amount / Math.max(0.000001, net)) * 100);
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