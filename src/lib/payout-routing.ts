// Platform-Intermediated Settlement + Auto-Payout Engine
// Flow: Revenue → Platform Settlement Account → [verify + split + fee deduct] → Auto-payout to Pre-Set Owner Accounts + Treasury Buckets
// Pattern: Stripe Connect / Adyen MarketPay / Wise Platform

import { prisma } from './db';
import { sha256 } from './strict-enforcement/crypto-utils';
import { getDisbursementPolicy } from './owner-config';
import { computeBucketSplit, allocateToBuckets, type BucketCode, BUCKET_CODES } from './treasury/buckets';

export interface SplitDestination {
  ownerAccountId?: string;
  bucketCode?: BucketCode;
  pct: number;
}

export interface SettleAndPayoutRequest {
  revenueEventId: string;
  amount: number;
  currency: string;
  sourceType: string;
  sourceRef?: string;
  platformFeePct?: number;
  overrideSplit?: SplitDestination[];
}

export interface SettleAndPayoutResult {
  success: boolean;
  settlementId: string;
  platformFee: number;
  netAmount: number;
  splits: Array<{
    ownerAccountId: string;
    amount: number;
    status: string;
  }>;
  receiptHash: string;
  error?: string;
}

export async function settleAndPayout(req: SettleAndPayoutRequest): Promise<SettleAndPayoutResult> {
  const revenue = await prisma.revenueEvent.findUnique({ where: { id: req.revenueEventId } });
  if (!revenue) {
    return { success: false, settlementId: '', platformFee: 0, netAmount: 0, splits: [], receiptHash: '', error: 'Revenue event not found' };
  }
  if (revenue.status === 'rejected') {
    return { success: false, settlementId: '', platformFee: 0, netAmount: 0, splits: [], receiptHash: '', error: 'Revenue event is rejected' };
  }

  const routingRule = await findRoutingRule(req.sourceType, req.amount, req.currency);
  const platformFeePct = req.platformFeePct ?? routingRule?.platformFeePct ?? 0;
  let splits: SplitDestination[] = req.overrideSplit ?? (routingRule ? (routingRule.destinationSplits as unknown as SplitDestination[]) : []);

  const platformFee = Math.round(req.amount * platformFeePct / 100 * 100) / 100;
  const netAmount = Math.round((req.amount - platformFee) * 100) / 100;

  // DEFAULT TREASURY FALLBACK: when no routing rule / no override exists,
  // split NET across the four treasury buckets using the disbursement policy.
  // Previously this returned 0 splits and silently swallowed owner value.
  if (splits.length === 0) {
    const policy = getDisbursementPolicy();
    const pct: Record<BucketCode, number> = {
      sovereign_reserves: policy.bucketPct.sovereignReserves,
      procurement_buffer: policy.bucketPct.procurementBuffer,
      runtime_operations: policy.bucketPct.runtimeOperations,
      salary_bucket: policy.bucketPct.salary,
    };
    splits = computeBucketSplit(netAmount, pct).map((b) => ({ bucketCode: b.code, pct: b.pct }));
  }

  const splitResults: SettleAndPayoutResult['splits'] = [];
  for (const split of splits) {
    const splitAmount = Math.round(netAmount * (split.pct ?? 0) / 100 * 100) / 100;
    if (splitAmount <= 0) continue;

    // Treasury-bucket split → accumulate into FundBucket, no external rail.
    if (split.bucketCode) {
      const bucketInput = {
        code: split.bucketCode,
        pct: split.pct,
        amount: splitAmount,
        revenueEventId: req.revenueEventId,
        sourceLabel: `Revenue: ${revenue.source} (${revenue.id})`,
      };
      const bucketResult = await allocateToBuckets([bucketInput]);
      if (!bucketResult.ok) {
        // FAIL-CLOSED: a failed bucket allocation must not silently swallow
        // owner value. The whole payout aborts (nothing is marked verified).
        return {
          success: false,
          settlementId: '',
          platformFee: 0,
          netAmount: 0,
          splits: [],
          receiptHash: '',
          error: `Treasury bucket allocation failed for ${split.bucketCode}: ${bucketResult.reason}`,
        };
      }
      splitResults.push({ ownerAccountId: `bucket:${split.bucketCode}`, amount: splitAmount, status: 'pending' });
      continue;
    }

    if (!split.ownerAccountId) continue;
    const settlement = await prisma.ownerSettlement.create({
      data: {
        ownerAccountId: split.ownerAccountId,
        amount: splitAmount,
        currency: req.currency,
        status: 'pending',
        direction: 'outbound',
        purpose: 'settlement',
        sourceLabel: `Revenue: ${revenue.source} (${revenue.id})`,
        fee: 0,
        netAmount: splitAmount,
        dataSource: 'internal_ledger_only',
        metadata: JSON.stringify({
          revenueEventId: req.revenueEventId,
          platformFee,
          splitPct: split.pct,
        }),
      },
    });

    splitResults.push({ ownerAccountId: split.ownerAccountId, amount: splitAmount, status: 'pending' });

    await prisma.ownerAccount.update({
      where: { id: split.ownerAccountId },
      data: { totalSent: { increment: splitAmount }, txCount: { increment: 1 } },
    });

    await prisma.auditLedger.create({
      data: {
        entityType: 'auto_payout',
        entityId: settlement.id,
        action: 'split_created',
        entryHash: await sha256(`payout:${settlement.id}:${splitAmount}:${split.pct}:${Date.now()}`),
        performedBy: 'auto-payout-engine',
        metadata: JSON.stringify({
          revenueEventId: req.revenueEventId,
          platformFee,
          splitPct: split.pct,
          ownerAccountId: split.ownerAccountId,
        }),
      },
    });
  }

  if (platformFee > 0) {
    await prisma.auditLedger.create({
      data: {
        entityType: 'platform_fee',
        entityId: req.revenueEventId,
        action: 'fee_collected',
        entryHash: await sha256(`fee:${req.revenueEventId}:${platformFee}:${Date.now()}`),
        performedBy: 'auto-payout-engine',
        metadata: JSON.stringify({ platformFee, source: revenue.source }),
      },
    });
  }

  await prisma.revenueEvent.update({
    where: { id: req.revenueEventId },
    data: { status: 'verified' },
  });

  const receiptHash = await sha256(JSON.stringify({
    revenueEventId: req.revenueEventId,
    amount: req.amount,
    platformFee,
    netAmount,
    splits: splitResults,
    ts: Date.now(),
  }));

  if (routingRule) {
    await prisma.payoutRoutingRule.update({
      where: { id: routingRule.id },
      data: { triggerCount: { increment: 1 }, lastTriggeredAt: new Date() },
    });
  }

  return { success: true, settlementId: `settle-${Date.now()}`, platformFee, netAmount, splits: splitResults, receiptHash };
}

async function findRoutingRule(sourceType: string, amount: number, currency: string) {
  const rules = await prisma.payoutRoutingRule.findMany({
    where: { isActive: true },
    orderBy: { priority: 'desc' },
  });

  for (const rule of rules) {
    if (rule.sourceType !== 'any' && rule.sourceType !== sourceType) continue;
    if (rule.totalPct !== 100) continue;
    if (rule.cooldownMs > 0 && rule.lastTriggeredAt) {
      const elapsed = Date.now() - rule.lastTriggeredAt.getTime();
      if (elapsed < rule.cooldownMs) continue;
    }
    if (rule.sourceFilter) {
      const filter = rule.sourceFilter as { minAmount?: number; currency?: string };
      if (typeof filter.minAmount === 'number' && amount < filter.minAmount) continue;
      if (filter.currency && filter.currency !== currency) continue;
    }
    return rule;
  }
  return null;
}

export async function getRoutingRules() {
  return prisma.payoutRoutingRule.findMany({ orderBy: { priority: 'desc' } });
}

export async function getPlatformAccounts() {
  // NOTE: platformSettlementAccount was a phantom model (never in schema.prisma).
  // The nearest real concept is OwnerAccount (isActive, accountType). Callers
  // should treat this as the active settlement-capable accounts list.
  return prisma.ownerAccount.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
}
