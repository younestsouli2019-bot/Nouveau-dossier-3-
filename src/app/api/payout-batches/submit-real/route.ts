import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { requireOpsAuth } from '@/lib/api-auth';
import { settlementEngine, type SettlementRail } from '@/lib/settlement/SettlementEngine';

interface SubmitRealBody {
  batchIds?: string[];
  provider?: string;
}

interface VerifiedOwnerAccounts {
  paypal: Awaited<ReturnType<typeof getVerifiedAccountsForRailKind>>['accounts'];
  payoneer: Awaited<ReturnType<typeof getVerifiedAccountsForRailKind>>['accounts'];
  bank_wire: Awaited<ReturnType<typeof getVerifiedAccountsForRailKind>>['accounts'];
}

interface BatchResult {
  batchId: string;
  batchNumber: string;
  provider: string;
  amount: number;
  items: number;
  providerBatchId: string;
  batchStatus: string;
  successfulItems: number;
  failedItems: number;
  error?: string;
  payoutItemIds?: string[];
}

const RAIL_KIND_FOR_PROVIDER: Record<string, SettlementRail['kind']> = {
  paypal: 'paypal',
  payoneer: 'payoneer',
  bank_transfer: 'bank_wire',
};

async function getVerifiedAccountsForRailKind(kind: SettlementRail['kind']) {
  const { prisma } = await import('@/lib/db');
  const accountTypesForRail = new Map<SettlementRail['kind'], string[]>([
    ['paypal', ['paypal']],
    ['payoneer', ['payoneer']],
    ['bank_wire', ['bank_wire', 'attijari', 'wise']],
    ['attijari', ['attijari']],
    ['wise', ['wise']],
    ['crypto', ['crypto']],
    ['stripe', ['stripe']],
  ]);
  const types = accountTypesForRail.get(kind) || [kind];
  const accounts = await prisma.ownerAccount.findMany({
    where: { isActive: true, verifiedAt: { not: null }, accountType: { in: types } },
    orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  return {
    accounts,
    primary: accounts.find((a) => a.isPrimary) || accounts[0] || null,
  };
}

async function getAllVerifiedOwnerAccounts(): Promise<VerifiedOwnerAccounts> {
  const [pp, po, bw] = await Promise.all([
    getVerifiedAccountsForRailKind('paypal'),
    getVerifiedAccountsForRailKind('payoneer'),
    getVerifiedAccountsForRailKind('bank_wire'),
  ]);
  return { paypal: pp.accounts, payoneer: po.accounts, bank_wire: bw.accounts };
}

function maskAccount(a: { id: string; accountHolder?: string | null; accountType: string; paypalEmail?: string | null; wiseEmail?: string | null; payoneerId?: string; accountNumber?: string | null; swiftCode?: string | null }) {
  const mask = (s: string | null | undefined, keepStart = 4, keepEnd = 3) => {
    if (!s) return null;
    if (s.length <= keepStart + keepEnd) return s.replace(/.(?!.{0,2}$)/g, '*');
    return s.slice(0, keepStart) + '*'.repeat(Math.max(1, s.length - keepStart - keepEnd)) + s.slice(-keepEnd);
  };
  const payoneerMask = a.wiseEmail || `payoneer-${(a.payoneerId || '').slice(-4) || '****'}`;
  return {
    id: a.id,
    accountHolder: a.accountHolder || 'Owner',
    accountType: a.accountType,
    paypalEmail: a.paypalEmail ? mask(a.paypalEmail, 2, 3) : null,
    payoneerMask: mask(payoneerMask, 2, 3),
    accountNumber: mask(a.accountNumber),
    swiftCode: mask(a.swiftCode, 4, 2),
  };
}

async function ensureRevenueEventForItem(
  item: { id: string; amount: number; currency: string; payoutBatchId: string; recipientName?: string | null },
  batchNumber: string,
) {
  const { prisma } = await import('@/lib/db');
  const existing = await prisma.revenueEvent.findFirst({
    where: {
      referenceId: { contains: item.id },
    },
    orderBy: { id: 'desc' },
  });
  if (existing) return existing.id;
  const referenceId = `payout-item:${item.id}:batch:${batchNumber}`;
  const created = await prisma.revenueEvent.create({
    data: {
      source: 'payout_batch_item',
      referenceId,
      amount: Number(item.amount),
      currency: item.currency.toUpperCase() || 'USD',
      status: 'verified',
      description: `Auto-created for payout item ${item.id} in batch ${batchNumber} — recipient ${item.recipientName || 'unknown'}`,
      payoutBatchId: item.payoutBatchId || null,
    },
  });
  return created.id;
}

export async function GET(request: NextRequest) {
  const denied = requireOpsAuth(request);
  if (denied) return denied;
  try {
    const verified = await getAllVerifiedOwnerAccounts();
    const allMasked = [
      ...verified.paypal.map(maskAccount),
      ...verified.payoneer.map(maskAccount),
      ...verified.bank_wire.map(maskAccount),
    ];
    return NextResponse.json({
      success: true,
      hasVerifiedPayPal: verified.paypal.length > 0,
      hasVerifiedPayoneer: verified.payoneer.length > 0,
      hasVerifiedBank: verified.bank_wire.length > 0,
      allVerifiedOwnerAccounts: allMasked,
      railKindForProvider: RAIL_KIND_FOR_PROVIDER,
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const denied = requireOpsAuth(request);
  if (denied) return denied;

  try {
    const body: SubmitRealBody = await request.json();
    const { batchIds, provider: providerOverride } = body;

    const verified = await getAllVerifiedOwnerAccounts();
    const allMasked = [
      ...verified.paypal.map(maskAccount),
      ...verified.payoneer.map(maskAccount),
      ...verified.bank_wire.map(maskAccount),
    ];

    let batches;
    if (batchIds && batchIds.length > 0) {
      batches = await db.payoutBatch.findMany({
        where: { id: { in: batchIds } },
        include: { items: true, transactionLogs: true },
        orderBy: { batchNumber: 'asc' },
      });
    } else {
      batches = await db.payoutBatch.findMany({
        where: {
          status: { in: ['submitted', 'approved', 'pending_approval'] },
        },
        include: { items: true, transactionLogs: true },
        orderBy: { batchNumber: 'asc' },
      });
    }

    if (batches.length === 0) {
      return NextResponse.json({
        success: false,
        message: 'No batches found to submit for real payment processing',
        results: [],
        allVerifiedOwnerAccounts: allMasked,
      });
    }

    const anyPayPal = batches.some((b) => (providerOverride || b.paymentProvider) === 'paypal');
    const anyPayoneer = batches.some((b) => (providerOverride || b.paymentProvider) === 'payoneer');
    const anyBank = batches.some((b) => (providerOverride || b.paymentProvider) === 'bank_transfer');
    if (anyPayPal && verified.paypal.length === 0) {
      return NextResponse.json(
        { success: false, error: 'NO_VERIFIED_PAYPAL_ACCOUNT: Destinations come from OwnerAccount (isActive=true, verifiedAt!=null, accountType=paypal). Add rows via owner-accounts/seed.', allVerifiedOwnerAccounts: allMasked },
        { status: 412 },
      );
    }
    if (anyPayoneer && verified.payoneer.length === 0) {
      return NextResponse.json(
        { success: false, error: 'NO_VERIFIED_PAYONEER_ACCOUNT: Destinations come from OwnerAccount (isActive=true, verifiedAt!=null, accountType=payoneer). Add rows via owner-accounts/seed.', allVerifiedOwnerAccounts: allMasked },
        { status: 412 },
      );
    }
    if (anyBank && verified.bank_wire.length === 0) {
      return NextResponse.json(
        { success: false, error: 'NO_VERIFIED_BANK_ACCOUNT: Destinations come from OwnerAccount (isActive=true, verifiedAt!=null, accountType=bank_wire|attijari|wise). Add rows via owner-accounts/seed.', allVerifiedOwnerAccounts: allMasked },
        { status: 412 },
      );
    }

    console.log(
      `[SubmitReal][HARDENED] Found ${batches.length} batches to process via SettlementEngine: ${batches.map((b) => b.batchNumber).join(', ')}`,
    );

    const now = new Date();
    const results: BatchResult[] = [];
    let totalSuccess = 0;
    let totalFailed = 0;

    for (const batch of batches) {
      const provider = (providerOverride || batch.paymentProvider) as string;
      const railKind = RAIL_KIND_FOR_PROVIDER[provider];

      if (!provider || !['paypal', 'payoneer', 'bank_transfer'].includes(provider) || !railKind) {
        const err = `Unknown or missing payment provider: "${provider}"`;
        console.error(`[SubmitReal] Batch ${batch.batchNumber}: ${err}`);
        results.push({
          batchId: batch.id,
          batchNumber: batch.batchNumber,
          provider: provider || 'unknown',
          amount: Number(batch.totalAmount),
          items: batch.items.length,
          providerBatchId: '',
          batchStatus: 'FAILED',
          successfulItems: 0,
          failedItems: batch.items.length,
          error: err,
        });
        totalFailed++;
        continue;
      }

      const destList =
        provider === 'paypal' ? verified.paypal :
        provider === 'payoneer' ? verified.payoneer :
        verified.bank_wire;
      const destOwner = destList.find((a) => a.isPrimary) || destList[0]!;

      const successfulItems: string[] = [];
      const failedItems: string[] = [];
      const payoutItemIds: string[] = [];
      let lastSEError: string | null = null;
      let providerBatchRefFromSE = '';

      for (const item of batch.items) {
        try {
          const revenueEventId = await ensureRevenueEventForItem(
            { id: item.id, amount: Number(item.amount), currency: item.currency, payoutBatchId: batch.id, recipientName: item.recipientName },
            batch.batchNumber,
          );
          const entitlementRef = `submit-real:batch:${batch.id}:item:${item.id}`;
          const idemKey = `submit-real-v1:${batch.id}:${item.id}`;
          const seResult = await settlementEngine.submitForSettlement({
            revenueEventId,
            ownerAccountId: destOwner.id,
            entitlementSourceRef: entitlementRef,
            idempotencyKey: idemKey,
            amount: Number(item.amount),
            currency: (item.currency || batch.currency || 'USD').toUpperCase(),
            railKind,
            actor: 'ops:submit-real',
            metadata: {
              payoutBatchId: batch.id,
              batchNumber: batch.batchNumber,
              payoutItemIdLegacy: item.id,
              provider,
              recipientName: item.recipientName,
              recipientEmail: item.recipientEmail,
              paymentMethod: item.paymentMethod,
              originalTransactionRef: item.transactionRef,
              idempotencyHit: false,
            },
          });
          payoutItemIds.push(seResult.payoutItemId);
          successfulItems.push(item.id);
          if (seResult.idempotencyHit) lastSEError = lastSEError || 'idempotency reused';
        } catch (se) {
          failedItems.push(item.id);
          const msg = se instanceof Error ? se.message : String(se);
          lastSEError = msg;
          console.error(`[SubmitReal] item=${item.id} SE failure:`, msg);
        }
      }

      const batchNotes = [
        batch.notes,
        `[SUBMIT-REAL VIA SETTLEMENTENGINE] provider=${provider}, railKind=${railKind}, ownerAccountId=${destOwner.id}, successful=${successfulItems.length}/${batch.items.length}, payoutItemIds=[${payoutItemIds.join(',')}]${lastSEError ? `, lastError=${lastSEError}` : ''}`,
      ].filter(Boolean).join(' | ');

      await db.payoutBatch.update({
        where: { id: batch.id },
        data: {
          status: successfulItems.length === batch.items.length ? 'submitted' : (successfulItems.length > 0 ? 'partial' : 'failed'),
          submittedAt: successfulItems.length > 0 ? now : batch.submittedAt,
          providerBatchRef: providerBatchRefFromSE || batch.providerBatchRef || undefined,
          notes: batchNotes,
        },
      });

      await db.payoutAuditLog.create({
        data: {
          entityType: 'batch',
          entityId: batch.id,
          action: 'submit_real_via_settlement_engine',
          newValue: JSON.stringify({
            provider,
            railKind,
            ownerAccountId: destOwner.id,
            successfulItems: successfulItems.length,
            failedItems: failedItems.length,
            payoutItemIds,
            totalAmount: Number(batch.totalAmount),
            perItemIds: { successfulItems, failedItems },
          }),
          reason: `Hardened submit-real via SettlementEngine 18-state state machine (UNKNOWN, idempotency, reconciliation). NEVER writes processing/settled without reconcile proofHash — reconciliationWorker polls provider for final status.`,
          performedBy: 'ops:submit-real (authed)',
          payoutBatchId: batch.id,
        },
      });

      results.push({
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        provider,
        amount: Number(batch.totalAmount),
        items: batch.items.length,
        providerBatchId: providerBatchRefFromSE || `SE-BRIDGED-${batch.id}`,
        batchStatus: successfulItems.length === batch.items.length ? 'SE_SUBMITTED' : (successfulItems.length > 0 ? 'PARTIAL' : 'FAILED'),
        successfulItems: successfulItems.length,
        failedItems: failedItems.length,
        error: failedItems.length > 0 ? (lastSEError || 'Some items failed SettlementEngine gate') : undefined,
        payoutItemIds,
      });

      if (successfulItems.length === batch.items.length) totalSuccess++;
      else totalFailed++;
    }

    const totalAmount = results.reduce((s, r) => s + r.amount, 0);
    const totalItems = results.reduce((s, r) => s + r.items, 0);

    return NextResponse.json({
      success: totalFailed === 0,
      message:
        totalFailed === 0
          ? `All ${results.length} batches submitted via SettlementEngine 18-state state machine. UNKNOWN state until ProviderReconciliationWorker attests provider-confirmed receipt with sha256 proofHash before SETTLED write.`
          : `${totalSuccess} of ${results.length} batches submitted via SE. ${totalFailed} batches have failed items.`,
      results,
      summary: {
        totalBatches: results.length,
        successfulBatches: totalSuccess,
        failedBatches: totalFailed,
        totalAmount,
        totalItems,
        submittedAt: now.toISOString(),
        stateMachineNote: 'All items at state PROVIDER_SUBMITTED/PROCESSING or earlier UNKNOWN on network failure. Run ProviderReconciliationWorker.runOnce() to poll providers and advance UNKNOWN→PROVIDER_RECONCILED→CONFIRMED→SETTLED (with proofHash).',
      },
      allVerifiedOwnerAccounts: allMasked,
    });
  } catch (error) {
    console.error('[SubmitReal] API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
