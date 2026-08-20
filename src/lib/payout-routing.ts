// Platform-Intermediated Settlement + Auto-Payout Engine
// Flow: Revenue → Platform Settlement Account → [verify + split + fee deduct] → Auto-payout to Pre-Set Owner Accounts
// Pattern: Stripe Connect / Adyen MarketPay / Wise Platform

import { prisma } from './db';
import { sha256 } from './strict-enforcement/crypto-utils';

export interface SplitDestination {
  ownerAccountId: string;
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
  const splits = req.overrideSplit ?? (routingRule ? JSON.parse(routingRule.destinationSplits) : []);

  const platformFee = Math.round(req.amount * platformFeePct / 100 * 100) / 100;
  const netAmount = Math.round((req.amount - platformFee) * 100) / 100;

  const splitResults: SettleAndPayoutResult['splits'] = [];
  for (const split of splits) {
    const splitAmount = Math.round(netAmount * split.pct / 100 * 100) / 100;
    if (splitAmount <= 0) continue;

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
      const filter = JSON.parse(rule.sourceFilter);
      if (filter.minAmount && amount < filter.minAmount) continue;
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
  return prisma.platformSettlementAccount.findMany({ where: { isActive: true } });
}
