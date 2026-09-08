import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireOpsAuth } from '@/lib/api-auth';
import { sha256 } from '@/lib/strict-enforcement/crypto-utils';
import { settlementEngine } from '@/lib/settlement/SettlementEngine';

async function getVerifiedOwnerBankAccounts(currency?: string) {
  const raw = await prisma.ownerAccount.findMany({
    where: {
      isActive: true,
      verifiedAt: { not: null },
      accountType: { in: ['bank_wire', 'attijari', 'wise', 'paypal', 'payoneer'] },
    },
    orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
  });
  if (raw.length === 0) {
    throw new Error(
      'NO_VERIFIED_OWNER_ACCOUNTS: Destinations come from OwnerAccount (isActive=true + verifiedAt IS NOT NULL). Seed via owner-accounts endpoint first.',
    );
  }
  const all = raw.map((a) => ({
    id: a.id,
    accountType: a.accountType,
    accountHolder: a.accountHolder,
    bankName: a.bankName,
    swiftCode: a.swiftCode,
    routingNumber: a.routingNumber,
    accountNumber: a.accountNumber,
    currency: a.currency,
    countryCode: a.countryCode,
    paypalEmail: a.paypalEmail,
    payoneerMask: a.wiseEmail || `payoneer-${(a.payoneerId || '').slice(-4) || '****'}`,
    isPrimary: a.isPrimary,
    maskIban: a.accountNumber ? `${a.accountNumber.slice(0, 4)}***${a.accountNumber.slice(-4)}` : undefined,
    maskAccount: a.accountNumber ? `***${a.accountNumber.slice(-4)}` : undefined,
  }));
  const preferred =
    (currency && all.find((a) => a.currency?.toUpperCase() === currency.toUpperCase())) ||
    all.find((a) => a.isPrimary) ||
    all[0];
  return { all, preferred };
}

function mask(val?: string | null, show = 4): string {
  if (!val) return '';
  if (val.length <= show * 2) return val.replace(/./g, '*');
  return `${val.slice(0, show)}***${val.slice(-show)}`;
}

export async function GET(req: NextRequest) {
  const denied = requireOpsAuth(req);
  if (denied) return denied;
  try {
    const { all } = await getVerifiedOwnerBankAccounts();
    return NextResponse.json({
      success: true,
      module: 'Settle & Payout',
      description: 'Platform-intermediated settlement with payouts routed via verified OwnerAccounts.',
      allVerifiedOwnerAccounts: all.map((a) => ({
        id: a.id,
        accountType: a.accountType,
        accountHolder: a.accountHolder,
        currency: a.currency,
        isPrimary: a.isPrimary,
        countryCode: a.countryCode,
        ibanMasked: a.maskIban,
        accountMasked: a.maskAccount,
        bankName: a.bankName,
        swiftMasked: mask(a.swiftCode),
        routingMasked: mask(a.routingNumber),
        paypalMasked: a.paypalEmail ? mask(a.paypalEmail) : undefined,
        payoneerMasked: mask(a.payoneerMask),
      })),
      verifiedCount: all.length,
    });
  } catch (e) {
    const msg = (e as Error)?.message || 'NO_VERIFIED_OWNER_ACCOUNTS';
    return NextResponse.json(
      { success: false, error: msg, allVerifiedOwnerAccounts: [] },
      { status: msg.includes('NO_VERIFIED') ? 412 : 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const denied = requireOpsAuth(req);
  if (denied) return denied;
  try {
    const body = await req.json();
    const {
      settlementId,
      amount,
      currency = 'MAD',
      recipientIban,
      recipientName,
      reference,
      paymentRail = 'bank',
      ownerAccountId,
      revenueEventId,
      entitlementSourceRef,
      idempotencyKey,
    } = body;

    if (!settlementId || !amount) {
      return NextResponse.json(
        { error: 'settlementId and amount are required' },
        { status: 400 },
      );
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }
    const curr = String(currency || 'MAD').toUpperCase();

    const { all, preferred } = await getVerifiedOwnerBankAccounts(curr);
    const chosenOwner =
      (ownerAccountId && all.find((a) => a.id === String(ownerAccountId))) || preferred;
    if (!chosenOwner) {
      return NextResponse.json(
        { success: false, error: 'NO_VERIFIED_OWNER_ACCOUNT_FOR_CURRENCY', allVerifiedOwnerAccounts: all.map(a => ({ id: a.id, currency: a.currency, type: a.accountType })) },
        { status: 412 },
      );
    }

    let rail: 'paypal' | 'bank_wire' | 'crypto' | 'payoneer' | 'wise' | 'stripe' | 'tron' | 'google_pay' | 'attijari';
    if (paymentRail === 'paypal' || chosenOwner.accountType === 'paypal') rail = 'paypal';
    else if (paymentRail === 'payoneer' || chosenOwner.accountType === 'payoneer') rail = 'payoneer';
    else if (paymentRail === 'wise' || chosenOwner.accountType === 'wise') rail = 'wise';
    else if (paymentRail === 'attijari' || /attijari|psd2/i.test(String(paymentRail)) || chosenOwner.accountType === 'attijari') rail = 'attijari';
    else rail = 'bank_wire';

    let revId = revenueEventId;
    if (!revId) {
      const existing = await prisma.revenueEvent.findFirst({
        where: { referenceId: settlementId },
        orderBy: { createdAt: 'desc' },
      });
      revId = existing?.id;
    }
    if (!revId) {
      const created = await prisma.revenueEvent.create({
        data: {
          source: 'settle_and_payout_api',
          referenceId: settlementId,
          amount: amountNum,
          currency: curr,
          status: 'reconciled',
          description: reference || `Settle-and-payout settlement ${settlementId}`,
        },
      });
      revId = created.id;
    }

    const idem = idempotencyKey || `sap_${settlementId}_${chosenOwner.id}_${Date.now()}`;
    const ent = entitlementSourceRef || `settle_and_payout:${settlementId}`;

    const seResult = await settlementEngine.submitForSettlement({
      revenueEventId: revId,
      ownerAccountId: chosenOwner.id,
      entitlementSourceRef: ent,
      idempotencyKey: idem,
      amount: amountNum,
      currency: curr,
      railKind: rail,
      actor: 'settle-and-payout:POST',
      metadata: {
        settlementId,
        paymentRail,
        reference: reference || undefined,
        recipientIban: recipientIban ? mask(String(recipientIban)) : undefined,
        recipientName: recipientName || undefined,
      },
    });

    const payoutItem = await prisma.payoutItem.findUnique({
      where: { id: seResult.payoutItemId },
      select: {
        id: true, status: true, amount: true, currency: true,
        ownerAccountId: true, payoutBatchId: true, batchNumber: true,
        reconciliationStatus: true, externalRef: true,
      },
    });

    const entryHash = await sha256(JSON.stringify({
      settlementId, amountNum, currency: curr,
      rail, ownerAccountId: chosenOwner.id,
      payoutItemId: seResult.payoutItemId, idempotencyHit: seResult.idempotencyHit, ts: Date.now(),
    }));
    await prisma.auditLedger.create({
      data: {
        entityType: 'settle_and_payout',
        entityId: settlementId,
        action: `submit:${seResult.state}`,
        entryHash,
        performedBy: 'settlement-engine',
        metadata: JSON.stringify({
          revenueEventId: revId,
          payoutItemId: seResult.payoutItemId,
          ownerAccountId: chosenOwner.id,
          rail,
          idempotencyKey: idem,
          idempotencyHit: seResult.idempotencyHit,
          state: seResult.state,
        }),
      },
    });

    return NextResponse.json({
      success: true,
      settlementId,
      state: seResult.state,
      payoutItemId: seResult.payoutItemId,
      payoutBatchId: payoutItem?.payoutBatchId,
      batchNumber: payoutItem?.batchNumber,
      rail,
      amount: amountNum,
      currency: curr,
      ownerAccountId: chosenOwner.id,
      ownerAccountLabel: {
        id: chosenOwner.id,
        type: chosenOwner.accountType,
        holder: chosenOwner.accountHolder,
        currency: chosenOwner.currency,
        ibanMasked: chosenOwner.maskIban,
        bankName: chosenOwner.bankName,
        swiftMasked: mask(chosenOwner.swiftCode),
        paypalMasked: chosenOwner.paypalEmail ? mask(chosenOwner.paypalEmail) : undefined,
      },
      idempotencyHit: seResult.idempotencyHit,
      idempotencyKey: idem,
      revenueEventId: revId,
      reference: reference || undefined,
      allVerifiedOwnerAccounts: all.map((a) => ({
        id: a.id,
        accountType: a.accountType,
        accountHolder: a.accountHolder,
        currency: a.currency,
        isPrimary: a.isPrimary,
        ibanMasked: a.maskIban,
        bankName: a.bankName,
      })),
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const msg = (err as Error)?.message || 'Internal server error';
    const status = /NO_VERIFIED/.test(msg) ? 412 : 500;
    console.error('[Settlements/SettleAndPayout] Error:', err);
    return NextResponse.json({ success: false, error: msg }, { status });
  }
}
