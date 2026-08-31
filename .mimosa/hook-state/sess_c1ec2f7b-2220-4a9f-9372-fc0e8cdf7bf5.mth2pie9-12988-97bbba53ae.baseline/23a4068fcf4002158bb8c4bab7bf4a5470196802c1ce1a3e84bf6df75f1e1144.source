// Payoneer account reconciliation
// Tracks zero-balance discrepancy between Payoneer balances and connected bank accounts (Citibank USD, Barclays GBP)

import { prisma } from './db';
import { sha256 } from './strict-enforcement/crypto-utils';

export interface PayoneerBalance {
  currency: string;
  amount: number;
}

export interface PayoneerBankConnection {
  bankName: string;
  currency: string;
  totalTransfers: number;
  completed: number;
  pending: number;
  failed: number;
  totalAmount: number;
  lastUpdated?: Date;
}

export interface PayoneerReconciliationReport {
  id: string;
  balances: PayoneerBalance[];
  connections: PayoneerBankConnection[];
  discrepancy: DiscrepancyEntry[];
  totalInPayoneer: number;
  totalInConnections: number;
  netDiscrepancy: number;
  resolvedAt?: Date;
  notes?: string;
  createdAt: Date;
}

export interface DiscrepancyEntry {
  bankName: string;
  currency: string;
  bankTotal: number;
  payoneerBalance: number;
  difference: number;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  explanation?: string;
}

const KNOWN_BALANCES: PayoneerBalance[] = [
  { currency: 'USD', amount: 0.00 },
  { currency: 'EUR', amount: 0.00 },
  { currency: 'GBP', amount: 0.00 },
];

const KNOWN_CONNECTIONS: PayoneerBankConnection[] = [
  {
    bankName: 'Citibank USD',
    currency: 'USD',
    totalTransfers: 17,
    completed: 14,
    pending: 0,
    failed: 3,
    totalAmount: 45480.00,
  },
  {
    bankName: 'Barclays GBP',
    currency: 'GBP',
    totalTransfers: 0,
    completed: 0,
    pending: 0,
    failed: 0,
    totalAmount: 0,
  },
];

const PAYONEER_LINKS: Record<string, string> = {
  'Citibank USD': 'https://link.payoneer.com/Token?t=4D941C28495742279549302EBBE0A44A&src=pl',
  'Barclays GBP': 'https://link.payoneer.com/Token?t=03A1239E810D4910A692D9FAA971E5E7&src=pl',
};

export async function reconcilePayoneer(): Promise<PayoneerReconciliationReport> {
  const balances = KNOWN_BALANCES;
  const connections = KNOWN_CONNECTIONS;

  const discrepancy: DiscrepancyEntry[] = [];

  for (const conn of connections) {
    const payoneerBal = balances.find(b => b.currency === conn.currency);
    const payoneerAmount = payoneerBal?.amount || 0;
    const difference = conn.totalAmount - payoneerAmount;

    let severity: DiscrepancyEntry['severity'] = 'INFO';
    let explanation: string | undefined;

    if (Math.abs(difference) > 10000) {
      severity = 'CRITICAL';
      explanation = `${conn.bankName} shows $${conn.totalAmount.toLocaleString()} in transfers but Payoneer ${conn.currency} balance is $${payoneerAmount}. Possible causes: (1) settlement delay (2-5 business days), (2) funds routed directly to bank without Payoneer holding, (3) failed transactions consuming balance.`;
    } else if (Math.abs(difference) > 1000) {
      severity = 'WARNING';
      explanation = `Balance mismatch between ${conn.bankName} transfers and Payoneer ${conn.currency}. May be pending settlement.`;
    }

    discrepancy.push({
      bankName: conn.bankName,
      currency: conn.currency,
      bankTotal: conn.totalAmount,
      payoneerBalance: payoneerAmount,
      difference,
      severity,
      explanation,
    });
  }

  const totalInPayoneer = balances.reduce((sum, b) => sum + b.amount, 0);
  const totalInConnections = connections.reduce((sum, c) => sum + c.totalAmount, 0);
  const netDiscrepancy = totalInConnections - totalInPayoneer;

  const proofHash = await sha256(JSON.stringify({
    balances,
    connections,
    discrepancy,
    ts: Date.now(),
  }));

  await prisma.auditLedger.create({
    data: {
      entityType: 'payoneer_reconciliation',
      entityId: proofHash.slice(0, 16),
      action: 'reconciled',
      entryHash: proofHash,
      performedBy: 'payoneer-reconciliation-engine',
      metadata: JSON.stringify({
        totalInPayoneer,
        totalInConnections,
        netDiscrepancy,
        discrepancyCount: discrepancy.filter(d => d.severity !== 'INFO').length,
      }),
    },
  });

  return {
    id: proofHash.slice(0, 16),
    balances,
    connections,
    discrepancy,
    totalInPayoneer,
    totalInConnections,
    netDiscrepancy,
    createdAt: new Date(),
  };
}

export async function resolveDiscrepancy(bankName: string, notes: string): Promise<{ success: boolean; message: string }> {
  const conn = KNOWN_CONNECTIONS.find(c => c.bankName === bankName);
  if (!conn) return { success: false, message: `Connection ${bankName} not found` };

  await prisma.auditLedger.create({
    data: {
      entityType: 'payoneer_reconciliation',
      entityId: bankName,
      action: 'discrepancy_resolved',
      entryHash: await sha256(`resolve:${bankName}:${Date.now()}`),
      performedBy: 'manual',
      discrepancyNote: notes,
    },
  });

  return { success: true, message: `Discrepancy for ${bankName} marked as resolved: ${notes}` };
}

export function getPayoneerLinks(): Record<string, string> {
  return { ...PAYONEER_LINKS };
}
