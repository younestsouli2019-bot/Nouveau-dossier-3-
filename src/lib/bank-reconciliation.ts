// ─── Bank Reconciliation Engine ─────────────────────────────────────
// ISO 20022 Camt.053 reconciliation loop with discrepancy matrix.
// Matches internal OwnerSettlement records against external bank statements.
//
// Discrepancy matrix:
//   Exact match      → auto-settle
//   Currency mismatch → FX check + flag
//   Amount discrepancy → fee deduction + human sign-off required
//   Missing bank ref  → unmatchable, flag for manual review
//   Duplicate bank tx → block, alert
// ────────────────────────────────────────────────────────────────────────────

import { db } from './db';
import { sha256 } from './strict-enforcement/crypto-utils';

export type BankStatementEntry = {
  transactionId: string;
  date: string;
  amount: number;
  currency: string;
  counterpartyName?: string;
  counterpartyIban?: string;
  reference?: string;
  endToEndId?: string;
  bookingStatus: string;
  bankFee?: number;
  exchangeRate?: number;
};

export type MatchResult = {
  settlementId: string;
  bankEntryId: string;
  matchType: 'exact' | 'currency_mismatch' | 'amount_discrepancy' | 'reference_only';
  internalAmount: number;
  bankAmount: number;
  internalCurrency: string;
  bankCurrency: string;
  feeDeduction: number;
  fxRate?: number;
  discrepancyUsd: number;
  requiresHumanSignoff: boolean;
  autoSettled: boolean;
  reason: string;
};

export type ReconciliationReport = {
  timestamp: string;
  totalInternalSettlements: number;
  totalBankEntries: number;
  matched: number;
  unmatchedInternal: number;
  unmatchedBank: number;
  exactMatches: number;
  currencyMismatches: number;
  amountDiscrepancies: number;
  referenceOnlyMatches: number;
  duplicatesBlocked: number;
  totalDiscrepancyUsd: number;
  matches: MatchResult[];
  unmatchedBankIds: string[];
  unmatchedSettlementIds: string[];
  duplicateBankTxIds: string[];
  humanSignoffRequired: string[];
};

const MATCH_TOLERANCE_USD = 0.01;
const FEE_TOLERANCE_USD = 5.00;

function parseCamt053Xml(xml: string): BankStatementEntry[] {
  const entries: BankStatementEntry[] = [];

  const ntryRegex = /<Ntry>([\s\S]*?)<\/Ntry>/g;
  let ntryMatch: RegExpExecArray | null;

  while ((ntryMatch = ntryRegex.exec(xml)) !== null) {
    const ntryXml = ntryMatch[1];

    const amtMatch = ntryXml.match(/<Amt Ccy="([^"]*)">([\d.]+)<\/Amt>/);
    const amount = amtMatch ? parseFloat(amtMatch[2]) : 0;
    const currency = amtMatch ? amtMatch[1] : 'USD';

    const stmtIdMatch = ntryXml.match(/<AcctSvcrRef>([^<]+)<\/AcctSvcrRef>/);
    const transactionId = stmtIdMatch ? stmtIdMatch[1] : `TXN-${entries.length}`;

    const dateMatch = ntryXml.match(/<BookgDt><Dt>([^<]+)<\/Dt><\/BookgDt>/);
    const date = dateMatch ? dateMatch[1] : new Date().toISOString().slice(0, 10);

    const statusMatch = ntryXml.match(/<CdtDbtInd>([^<]+)<\/CdtDbtInd>/);
    const bookingStatus = statusMatch ? statusMatch[1] : 'CRDT';

    const refMatch = ntryXml.match(/<Ref>([^<]+)<\/Ref>/);
    const reference = refMatch ? refMatch[1] : undefined;

    const e2eMatch = ntryXml.match(/<EndToEndId>([^<]+)<\/EndToEndId>/);
    const endToEndId = e2eMatch ? e2eMatch[1] : undefined;

    const nmMatch = ntryXml.match(/<Nm>([^<]+)<\/Nm>/);
    const counterpartyName = nmMatch ? nmMatch[1] : undefined;

    const ibanMatch = ntryXml.match(/<IBAN>([^<]+)<\/IBAN>/);
    const counterpartyIban = ibanMatch ? ibanMatch[1] : undefined;

    const feeMatch = ntryXml.match(/<Chrgs><Chrg><Amt[^>]*>([\d.]+)<\/Amt>/);
    const bankFee = feeMatch ? parseFloat(feeMatch[1]) : undefined;

    const fxMatch = ntryXml.match(/<XchgRate>([\d.]+)<\/XchgRate>/);
    const exchangeRate = fxMatch ? parseFloat(fxMatch[1]) : undefined;

    entries.push({
      transactionId,
      date,
      amount,
      currency,
      counterpartyName,
      counterpartyIban,
      reference,
      endToEndId,
      bookingStatus,
      bankFee,
      exchangeRate,
    });
  }

  return entries;
}

interface BankStmt {
  BkToCstmrStmt?: {
    Stmt?: {
      Ntry?: Array<{
        Amt?: { $?: { Ccy?: string }; _?: string };
        AcctSvcrRef?: string;
        BookgDt?: { Dt?: string };
        CdtDbtInd?: string;
        NtryDtls?: {
          TxDtls?: Array<{
            Rmted?: { Cdtr?: { Nm?: string } };
            Ref?: string;
            EndToEndId?: string;
          }>;
        };
      }>;
    };
  };
}

function parseCamt053Json(json: Record<string, unknown>): BankStatementEntry[] {
  const stmt = json as BankStmt;
  const entries = stmt?.BkToCstmrStmt?.Stmt?.Ntry ?? [];
  return entries.map((ntry, i) => {
    const tx = ntry?.NtryDtls?.TxDtls?.[0];
    const amtObj = ntry.Amt;
    const amount = parseFloat(amtObj?._ ?? '0');
    const currency = amtObj?.$?.Ccy ?? 'USD';
    return {
      transactionId: ntry.AcctSvcrRef ?? `TXN-${i}`,
      date: ntry.BookgDt?.Dt ?? new Date().toISOString().slice(0, 10),
      amount,
      currency,
      counterpartyName: tx?.Rmted?.Cdtr?.Nm,
      reference: tx?.Ref,
      endToEndId: tx?.EndToEndId,
      bookingStatus: ntry.CdtDbtInd ?? 'CRDT',
    };
  });
}

function matchSettlementToBank(
  settlement: {
    id: string;
    amount: number;
    currency: string;
    externalRef?: string | null;
    referenceId?: string | null;
  },
  bankEntries: BankStatementEntry[],
): MatchResult | null {
  let bestMatch: MatchResult | null = null;
  let bestScore = -1;

  for (const bankEntry of bankEntries) {
    const sameCurrency = settlement.currency === bankEntry.currency;
    const amountDiff = Math.abs(settlement.amount - bankEntry.amount);
    const refMatch =
      (settlement.externalRef && bankEntry.reference === settlement.externalRef) ||
      (settlement.referenceId && bankEntry.endToEndId === settlement.referenceId) ||
      (settlement.externalRef && bankEntry.transactionId === settlement.externalRef);

    if (sameCurrency && amountDiff < MATCH_TOLERANCE_USD) {
      return {
        settlementId: settlement.id,
        bankEntryId: bankEntry.transactionId,
        matchType: 'exact',
        internalAmount: settlement.amount,
        bankAmount: bankEntry.amount,
        internalCurrency: settlement.currency,
        bankCurrency: bankEntry.currency,
        feeDeduction: bankEntry.bankFee ?? 0,
        fxRate: bankEntry.exchangeRate,
        discrepancyUsd: 0,
        requiresHumanSignoff: false,
        autoSettled: true,
        reason: 'Exact amount and currency match',
      };
    }

    if (!sameCurrency && bankEntry.exchangeRate) {
      const convertedAmount = bankEntry.amount * bankEntry.exchangeRate;
      const fxDiff = Math.abs(settlement.amount - convertedAmount);
      if (fxDiff < FEE_TOLERANCE_USD) {
        return {
          settlementId: settlement.id,
          bankEntryId: bankEntry.transactionId,
          matchType: 'currency_mismatch',
          internalAmount: settlement.amount,
          bankAmount: bankEntry.amount,
          internalCurrency: settlement.currency,
          bankCurrency: bankEntry.currency,
          feeDeduction: bankEntry.bankFee ?? 0,
          fxRate: bankEntry.exchangeRate,
          discrepancyUsd: fxDiff,
          requiresHumanSignoff: false,
          autoSettled: true,
          reason: `Currency mismatch: ${settlement.currency} vs ${bankEntry.currency} (FX rate: ${bankEntry.exchangeRate})`,
        };
      }
    }

    if (sameCurrency && amountDiff <= FEE_TOLERANCE_USD && amountDiff > MATCH_TOLERANCE_USD) {
      const feeDeduction = bankEntry.bankFee ?? 0;
      const adjustedDiff = Math.abs(amountDiff - feeDeduction);
      if (adjustedDiff < MATCH_TOLERANCE_USD) {
        return {
          settlementId: settlement.id,
          bankEntryId: bankEntry.transactionId,
          matchType: 'amount_discrepancy',
          internalAmount: settlement.amount,
          bankAmount: bankEntry.amount,
          internalCurrency: settlement.currency,
          bankCurrency: bankEntry.currency,
          feeDeduction,
          fxRate: bankEntry.exchangeRate,
          discrepancyUsd: amountDiff,
          requiresHumanSignoff: true,
          autoSettled: false,
          reason: `Amount discrepancy of $${amountDiff.toFixed(2)} explained by bank fee of $${feeDeduction.toFixed(2)}`,
        };
      }
    }

    if (refMatch) {
      const score = amountDiff < 10 ? 2 : 1;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = {
          settlementId: settlement.id,
          bankEntryId: bankEntry.transactionId,
          matchType: 'reference_only',
          internalAmount: settlement.amount,
          bankAmount: bankEntry.amount,
          internalCurrency: settlement.currency,
          bankCurrency: bankEntry.currency,
          feeDeduction: bankEntry.bankFee ?? 0,
          fxRate: bankEntry.exchangeRate,
          discrepancyUsd: amountDiff,
          requiresHumanSignoff: true,
          autoSettled: false,
          reason: `Reference matched but amount differs by $${amountDiff.toFixed(2)}`,
        };
      }
    }
  }

  return bestMatch;
}

export function parseCamt053(input: string): BankStatementEntry[] {
  const trimmed = input.trim();
  if (trimmed.startsWith('<')) {
    return parseCamt053Xml(trimmed);
  }
  if (trimmed.startsWith('{')) {
    return parseCamt053Json(JSON.parse(trimmed));
  }
  throw new Error('Unrecognized Camt.053 format: expected XML or JSON');
}

export async function runBankReconciliation(
  camt053Input: string,
): Promise<ReconciliationReport> {
  const now = new Date();
  const bankEntries = parseCamt053(camt053Input);

  const unsettledSettlements = await db.ownerSettlement.findMany({
    where: {
      status: { in: ['pending', 'processing'] },
      direction: 'inbound',
    },
  });

  const matchedSettlementIds = new Set<string>();
  const matchedBankIds = new Set<string>();
  const matches: MatchResult[] = [];
  const humanSignoffRequired: string[] = [];
  const duplicateBankTxIds: string[] = [];

  const seenBankTxIds = new Map<string, number>();
  for (const entry of bankEntries) {
    const count = seenBankTxIds.get(entry.transactionId) ?? 0;
    seenBankTxIds.set(entry.transactionId, count + 1);
    if (count > 0) {
      duplicateBankTxIds.push(entry.transactionId);
    }
  }

  const uniqueBankEntries = bankEntries.filter(
    e => (seenBankTxIds.get(e.transactionId) ?? 0) <= 1,
  );

  for (const settlement of unsettledSettlements) {
    const match = matchSettlementToBank(settlement, uniqueBankEntries);
    if (match && !matchedBankIds.has(match.bankEntryId)) {
      matches.push(match);
      matchedSettlementIds.add(match.settlementId);
      matchedBankIds.add(match.bankEntryId);

      if (match.requiresHumanSignoff) {
        humanSignoffRequired.push(match.settlementId);
      }

      if (match.autoSettled && match.requiresHumanSignoff === false) {
        const proofHash = sha256(
          `${settlement.id}:${match.bankEntryId}:${settlement.amount}:${settlement.currency}:reconciled`,
        );

        await db.ownerSettlement.update({
          where: { id: settlement.id },
          data: {
            status: 'completed',
            externalRef: match.bankEntryId,
            verifiedAt: now,
            proofHash,
            settledAt: now,
            dataSource: 'live_bank_api',
            connectorStatus: 'live',
          },
        });
      }
    }
  }

  const unmatchedSettlementIds = unsettledSettlements
    .filter(s => !matchedSettlementIds.has(s.id))
    .map(s => s.id);

  const unmatchedBankIds = uniqueBankEntries
    .filter(e => !matchedBankIds.has(e.transactionId))
    .map(e => e.transactionId);

  const totalDiscrepancyUsd = matches.reduce((sum, m) => sum + m.discrepancyUsd, 0);

  const exactMatches = matches.filter(m => m.matchType === 'exact').length;
  const currencyMismatches = matches.filter(m => m.matchType === 'currency_mismatch').length;
  const amountDiscrepancies = matches.filter(m => m.matchType === 'amount_discrepancy').length;
  const referenceOnlyMatches = matches.filter(m => m.matchType === 'reference_only').length;

  const report: ReconciliationReport = {
    timestamp: now.toISOString(),
    totalInternalSettlements: unsettledSettlements.length,
    totalBankEntries: bankEntries.length,
    matched: matches.length,
    unmatchedInternal: unmatchedSettlementIds.length,
    unmatchedBank: unmatchedBankIds.length,
    exactMatches,
    currencyMismatches,
    amountDiscrepancies,
    referenceOnlyMatches,
    duplicatesBlocked: duplicateBankTxIds.length,
    totalDiscrepancyUsd: Math.round(totalDiscrepancyUsd * 100) / 100,
    matches,
    unmatchedBankIds,
    unmatchedSettlementIds,
    duplicateBankTxIds,
    humanSignoffRequired,
  };

  console.log(
    `[BankReconciliation] Complete: ${matches.length}/${unsettledSettlements.length} matched, ` +
      `${exactMatches} exact, ${currencyMismatches} FX, ${amountDiscrepancies} discrepancies, ` +
      `${duplicateBankTxIds.length} duplicates blocked, $${totalDiscrepancyUsd.toFixed(2)} total discrepancy`,
  );

  return report;
}

export async function approveAmountDiscrepancy(
  settlementId: string,
  bankEntryId: string,
  approvedBy: string,
): Promise<{ success: boolean; error?: string }> {
  const settlement = await db.ownerSettlement.findUnique({ where: { id: settlementId } });
  if (!settlement) {
    return { success: false, error: 'Settlement not found' };
  }
  if (settlement.status !== 'pending' && settlement.status !== 'processing') {
    return { success: false, error: `Settlement status is ${settlement.status}, expected pending/processing` };
  }

  const now = new Date();
  const proofHash = sha256(
    `${settlementId}:${bankEntryId}:${settlement.amount}:human_approved:${approvedBy}`,
  );

  await db.ownerSettlement.update({
    where: { id: settlementId },
    data: {
      status: 'completed',
      externalRef: bankEntryId,
      verifiedAt: now,
      proofHash,
      settledAt: now,
      dataSource: 'live_bank_api',
      connectorStatus: 'live',
      metadata: JSON.stringify({
        humanApprovedBy: approvedBy,
        humanApprovedAt: now.toISOString(),
        matchType: 'amount_discrepancy_approved',
      }),
    },
  });

  console.log(
    `[BankReconciliation] Settlement ${settlementId} human-approved by ${approvedBy}`,
  );

  return { success: true };
}
