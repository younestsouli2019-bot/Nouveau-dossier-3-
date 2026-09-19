export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { db as prisma } from '@/lib/db';
import { getOwnerLedgerStatus } from '@/lib/treasury/release-engine';

const STUCK_PAYOUT_STATUSES = ['UNKNOWN', 'RETRYABLE_FAILURE', 'PROVIDER_REJECTED'];
const PENDING_PAYOUT_STATUSES = ['CREATED', 'ELIGIBLE', 'RESERVED', 'VALIDATED', 'READY'];
const PROCESSING_PAYOUT_STATUSES = ['SUBMITTING', 'SUBMITTED', 'PROCESSING'];
const COMPLETED_PAYOUT_STATUSES = ['COMPLETED', 'RECONCILED'];

const BUCKET_TO_METADATA_LABELS: Record<string, string[]> = {
  salary: ['salary_bucket', 'Salary'],
  debt: ['debt_repayment', 'Debts'],
  sovereign: ['sovereign_reserves', 'Emergency'],
  runtime: ['runtime_operations', 'Infrastructure', 'Operational Costs'],
  procurement: ['procurement_buffer'],
};

function oneDayAgo(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d;
}

async function countPayoutsByStatus() {
  const rows = await prisma.payout.groupBy({
    by: ['status'],
    _count: { id: true },
  });
  const map: Record<string, number> = {};
  for (const r of rows) map[r.status] = r._count.id;
  return map;
}

async function sumCompletedLast24h() {
  const since = oneDayAgo();
  const result = await prisma.payout.aggregate({
    where: {
      status: { in: COMPLETED_PAYOUT_STATUSES },
      completedAt: { gte: since },
    },
    _sum: { netAmount: true },
    _count: { id: true },
  });
  return {
    count: result._count.id ?? 0,
    amount: Number(result._sum.netAmount ?? 0),
  };
}

async function byRailStats() {
  const since = oneDayAgo();
  const byDest = await prisma.payout.groupBy({
    by: ['destinationType', 'status'],
    _count: { id: true },
  });
  const pendingMap: Record<string, number> = { paypal: 0, bank: 0, crypto: 0, manual: 0 };
  const processingMap: Record<string, number> = { ...pendingMap };
  const completedMap: Record<string, number> = { ...pendingMap };
  const stuckMap: Record<string, number> = { ...pendingMap };

  for (const r of byDest) {
    const dest = r.destinationType || 'bank';
    const key = dest === 'payoneer' ? 'bank' : dest === 'manual' ? 'manual' : dest;
    const target = key === 'manual' ? 'manual' : key === 'bank' ? 'bank' : key === 'crypto' ? 'crypto' : 'paypal';
    if (STUCK_PAYOUT_STATUSES.includes(r.status)) stuckMap[target] += r._count.id;
    else if (PENDING_PAYOUT_STATUSES.includes(r.status)) pendingMap[target] += r._count.id;
    else if (PROCESSING_PAYOUT_STATUSES.includes(r.status)) processingMap[target] += r._count.id;
    else if (COMPLETED_PAYOUT_STATUSES.includes(r.status)) completedMap[target] += r._count.id;
  }

  const manualPending = await prisma.ownerSettlement.count({
    where: { connectorStatus: 'manual_attested_pending', status: 'processing' },
  });
  pendingMap.manual += manualPending;

  const manualCompleted24h = await prisma.ownerSettlement.count({
    where: {
      status: 'completed',
      connectorStatus: { in: ['live', 'manual_attested_finance'] },
      settledAt: { gte: since },
    },
  });
  completedMap.manual += manualCompleted24h;

  return {
    paypal: {
      pending: pendingMap.paypal,
      processing: processingMap.paypal,
      completed24h: completedMap.paypal,
      stuck: stuckMap.paypal,
    },
    bank_wire: {
      pending: pendingMap.bank,
      processing: processingMap.bank,
      completed24h: completedMap.bank,
      stuck: stuckMap.bank,
    },
    manual_mad: {
      pending: pendingMap.manual,
      processing: processingMap.manual,
      completed24h: completedMap.manual,
      stuck: stuckMap.manual,
    },
    crypto: {
      pending: pendingMap.crypto,
      processing: processingMap.crypto,
      completed24h: completedMap.crypto,
      stuck: stuckMap.crypto,
    },
  };
}

async function byBucketStats() {
  const result: Record<string, { pending: number; processing: number; completed24h: number; pendingAmount: number; completedAmount24h: number }> = {};
  const since = oneDayAgo();

  for (const bucket of Object.keys(BUCKET_TO_METADATA_LABELS)) {
    result[bucket] = { pending: 0, processing: 0, completed24h: 0, pendingAmount: 0, completedAmount24h: 0 };
  }

  const ownerSettlements = await prisma.ownerSettlement.findMany({
    where: { direction: 'outbound' },
    select: {
      status: true,
      amount: true,
      settledAt: true,
      metadata: true,
      connectorStatus: true,
    },
  });

  for (const s of ownerSettlements) {
    let meta: Record<string, unknown> = {};
    try {
      if (s.metadata) meta = JSON.parse(s.metadata);
    } catch {
      // ignore malformed JSON
    }
    const bucketCode = String(meta.bucketCode ?? meta.purpose ?? '');
    const matchedBucket = Object.entries(BUCKET_TO_METADATA_LABELS).find(([, labels]) =>
      labels.some((l) => bucketCode.includes(l) || (meta.sourceLabel && String(meta.sourceLabel).includes(l)))
    );
    if (!matchedBucket) continue;
    const [bucket] = matchedBucket;
    const isPending = s.status === 'processing' || s.connectorStatus === 'manual_attested_pending';
    const isProcessing = s.status === 'processing' && s.connectorStatus !== 'manual_attested_pending';
    const isCompleted24h = s.status === 'completed' && s.settledAt && s.settledAt >= since;
    if (isPending) {
      result[bucket].pending += 1;
      result[bucket].pendingAmount += Number(s.amount ?? 0);
    }
    if (isProcessing) result[bucket].processing += 1;
    if (isCompleted24h) {
      result[bucket].completed24h += 1;
      result[bucket].completedAmount24h += Number(s.amount ?? 0);
    }
  }

  return result;
}

async function byOwnerAccountStats() {
  const ledger = await getOwnerLedgerStatus();
  const since = oneDayAgo();
  const out: Array<{
    id: string;
    label: string;
    accountType: string;
    last4: string | null;
    currency: string;
    pendingCount: number;
    pendingAmount: number;
    completed24h: number;
    completedAmount24h: number;
    railReady: boolean;
  }> = [];

  for (const acc of ledger) {
    const pendingRows = await prisma.ownerSettlement.findMany({
      where: {
        ownerAccountId: acc.id,
        direction: 'outbound',
        OR: [{ status: 'processing' }, { connectorStatus: 'manual_attested_pending' }],
      },
      select: { amount: true },
    });
    const completedRows = await prisma.ownerSettlement.findMany({
      where: {
        ownerAccountId: acc.id,
        direction: 'outbound',
        status: 'completed',
        settledAt: { gte: since },
      },
      select: { amount: true },
    });
    out.push({
      id: acc.id,
      label: acc.label,
      accountType: acc.accountType,
      last4: acc.accountNumberLast ?? null,
      currency: acc.currency,
      pendingCount: pendingRows.length,
      pendingAmount: pendingRows.reduce((s, r) => s + Number(r.amount ?? 0), 0),
      completed24h: completedRows.length,
      completedAmount24h: completedRows.reduce((s, r) => s + Number(r.amount ?? 0), 0),
      railReady: Boolean(acc.railReady),
    });
  }

  return out;
}

export async function GET() {
  try {
    const statusCounts = await countPayoutsByStatus();
    const completed24h = await sumCompletedLast24h();

    let stuckCount = 0;
    let pendingCount = 0;
    let processingCount = 0;
    let completedCount = 0;
    for (const [status, count] of Object.entries(statusCounts)) {
      if (STUCK_PAYOUT_STATUSES.includes(status)) stuckCount += count;
      else if (PENDING_PAYOUT_STATUSES.includes(status)) pendingCount += count;
      else if (PROCESSING_PAYOUT_STATUSES.includes(status)) processingCount += count;
      else if (COMPLETED_PAYOUT_STATUSES.includes(status)) completedCount += count;
    }

    const ownerPaymentStuck = await prisma.ownerPayment.count({
      where: { status: 'stuck_in_transition' },
    });
    stuckCount += ownerPaymentStuck;
    const ownerPaymentPending = await prisma.ownerPayment.count({
      where: { status: { in: ['pending', 'routed'] } },
    });
    pendingCount += ownerPaymentPending;
    const ownerPaymentProcessing = await prisma.ownerPayment.count({
      where: { status: 'processing' },
    });
    processingCount += ownerPaymentProcessing;

    const manualPending = await prisma.ownerSettlement.count({
      where: {
        direction: 'outbound',
        OR: [{ connectorStatus: 'manual_attested_pending' }, { status: 'processing' }],
      },
    });
    pendingCount += manualPending;

    const byRail = await byRailStats();
    const byBucket = await byBucketStats();
    const byOwnerAccount = await byOwnerAccountStats();

    const summary = {
      stuckCount,
      pendingCount,
      processingCount,
      completedCount,
      totalAmountCompleted24h: completed24h.amount,
    };

    return Response.json({
      ok: true,
      summary,
      byRail,
      byBucket,
      byOwnerAccount,
      ownerPayoutSummary: summary,
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
