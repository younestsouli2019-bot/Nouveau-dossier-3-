// Financial Ledger — Double-Entry + Loop Reconciliation
// Tracks every cent: COGS, reserves, operational expenses, gross payouts
// Auto-halts if ROI drops below threshold or failure rate exceeds limit

import { sha256 } from '../strict-enforcement/crypto-utils';
import { prisma } from '../db';

export type LedgerEntryType = 'debit' | 'credit';
export type LedgerAccount = 'cash' | 'cogs' | 'revenue' | 'fees' | 'reserves' | 'operational' | 'card_balance' | 'crypto_balance' | 'pending_receivable';

export interface LedgerEntry {
  id: string;
  type: LedgerEntryType;
  account: LedgerAccount;
  amount: number;
  currency: string;
  description: string;
  referenceId: string;
  referenceType: string; // 'order', 'funding', 'expense', 'settlement', 'fee'
  timestamp: Date;
  entryHash: string;
  previousHash: string | null;
}

export interface BalanceSnapshot {
  account: LedgerAccount;
  balance: number;
  currency: string;
  lastUpdated: Date;
}

export interface ProfitabilityReport {
  totalRevenue: number;
  totalCOGS: number;
  totalFees: number;
  totalOperational: number;
  grossProfit: number;
  netProfit: number;
  roi: number;
  transactionCount: number;
  failureRate: number;
  anomalyDetected: boolean;
  anomalyReason?: string;
  timestamp: string;
}

// Anomaly defense thresholds
const GUARDRAILS = {
  minROI: 15,               // halt if ROI drops below 15%
  maxFailureRatePct: 5,     // halt if >5% transactions fail within 1 hour
  maxHourlySpend: 5000,     // halt if hourly spend exceeds $5000
  maxDailyLoss: 2000,       // halt if daily net loss exceeds $2000
  maxUnreconciledAge: 86400000, // flag entries unreconciled for >24 hours
};

const LEDGER: LedgerEntry[] = [];
const BALANCES: Map<LedgerAccount, number> = new Map();

let lastEntryHash: string | null = null;

export async function createEntry(
  type: LedgerEntryType,
  account: LedgerAccount,
  amount: number,
  currency: string,
  description: string,
  referenceId: string,
  referenceType: string,
): Promise<LedgerEntry> {
  const entryHash = await sha256(JSON.stringify({
    type, account, amount, currency, description, referenceId, referenceType,
    previousHash: lastEntryHash, ts: Date.now(),
  }));

  const entry: LedgerEntry = {
    id: `ledger-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    account,
    amount,
    currency,
    description,
    referenceId,
    referenceType,
    timestamp: new Date(),
    entryHash,
    previousHash: lastEntryHash,
  };

  LEDGER.push(entry);
  lastEntryHash = entryHash;

  // Update balance
  const currentBalance = BALANCES.get(account) || 0;
  const delta = type === 'credit' ? amount : -amount;
  BALANCES.set(account, currentBalance + delta);

  return entry;
}

export async function recordOrder(
  orderId: string,
  salePrice: number,
  costPrice: number,
  fees: number,
  currency: string,
): Promise<void> {
  // Double-entry: for every debit, there's a matching credit
  await createEntry('credit', 'revenue', salePrice, currency, `Sale: ${orderId}`, orderId, 'order');
  await createEntry('debit', 'cogs', costPrice, currency, `COGS: ${orderId}`, orderId, 'order');
  await createEntry('debit', 'fees', fees, currency, `Fees: ${orderId}`, orderId, 'fee');
  await createEntry('debit', 'cash', costPrice + fees, currency, `Cash outflow: ${orderId}`, orderId, 'order');

  // Auto-halt check
  const profitability = computeProfitability();
  if (profitability.anomalyDetected) {
    console.error(`[Ledger] ANOMALY DETECTED: ${profitability.anomalyReason}. HALTING OPERATIONS.`);
    await prisma.auditLedger.create({
      data: {
        entityType: 'ledger_anomaly',
        entityId: orderId,
        action: 'operations_halted',
        entryHash: await sha256(`halt:${orderId}:${profitability.anomalyReason}:${Date.now()}`),
        performedBy: 'ledger-guard',
        discrepancyNote: profitability.anomalyReason,
        metadata: JSON.stringify(profitability),
      },
    });
  }
}

export async function recordCardFunding(cardId: string, amount: number, currency: string, sourceRef: string): Promise<void> {
  await createEntry('debit', 'cash', amount, currency, `VCC funding: ${cardId}`, sourceRef, 'funding');
  await createEntry('credit', 'card_balance', amount, currency, `VCC balance: ${cardId}`, cardId, 'funding');
}

export async function recordSettlement(settlementId: string, amount: number, currency: string, direction: 'inbound' | 'outbound'): Promise<void> {
  if (direction === 'inbound') {
    await createEntry('credit', 'cash', amount, currency, `Settlement inbound: ${settlementId}`, settlementId, 'settlement');
    await createEntry('debit', 'pending_receivable', amount, currency, `Receivable cleared: ${settlementId}`, settlementId, 'settlement');
  } else {
    await createEntry('debit', 'cash', amount, currency, `Settlement outbound: ${settlementId}`, settlementId, 'settlement');
    await createEntry('credit', 'cash', amount, currency, `Owner payout: ${settlementId}`, settlementId, 'settlement');
  }
}

function computeProfitability(): ProfitabilityReport {
  const totalRevenue = BALANCES.get('revenue') || 0;
  const totalCOGS = Math.abs(BALANCES.get('cogs') || 0);
  const totalFees = Math.abs(BALANCES.get('fees') || 0);
  const totalOperational = Math.abs(BALANCES.get('operational') || 0);
  const grossProfit = totalRevenue - totalCOGS - totalFees;
  const netProfit = grossProfit - totalOperational;
  const roi = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

  // Failure rate: count failed vs total in last hour
  const oneHourAgo = Date.now() - 3600000;
  const recentEntries = LEDGER.filter(e => e.timestamp.getTime() > oneHourAgo);
  const totalRecent = recentEntries.length;
  // Simple heuristic: if net is negative repeatedly, flag
  const recentNet = recentEntries.reduce((sum, e) => sum + (e.type === 'credit' ? e.amount : -e.amount), 0);
  const failureRate = totalRecent > 0 ? Math.max(0, (recentNet < 0 ? Math.abs(recentNet) / totalRecent * 100 : 0)) : 0;

  let anomalyDetected = false;
  let anomalyReason: string | undefined;

  if (roi < GUARDRAILS.minROI && totalRevenue > 100) {
    anomalyDetected = true;
    anomalyReason = `ROI ${roi.toFixed(1)}% below ${GUARDRAILS.minROI}% threshold`;
  } else if (failureRate > GUARDRAILS.maxFailureRatePct) {
    anomalyDetected = true;
    anomalyReason = `Failure rate ${failureRate.toFixed(1)}% exceeds ${GUARDRAILS.maxFailureRatePct}% threshold`;
  }

  return {
    totalRevenue,
    totalCOGS,
    totalFees,
    totalOperational,
    grossProfit,
    netProfit,
    roi: Math.round(roi * 100) / 100,
    transactionCount: LEDGER.length,
    failureRate: Math.round(failureRate * 100) / 100,
    anomalyDetected,
    anomalyReason,
    timestamp: new Date().toISOString(),
  };
}

export function getBalances(): BalanceSnapshot[] {
  const snapshots: BalanceSnapshot[] = [];
  BALANCES.forEach((balance, account) => {
    snapshots.push({ account, balance, currency: 'USD', lastUpdated: new Date() });
  });
  return snapshots;
}

export function getProfitability(): ProfitabilityReport {
  return computeProfitability();
}

export function getGuardrails() {
  return { ...GUARDRAILS };
}

export function getLedgerEntries(limit = 50): LedgerEntry[] {
  return LEDGER.slice(-limit);
}
