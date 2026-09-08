import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { requireOpsAuth } from '@/lib/api-auth';
import { killFabrication } from '@/lib/strict-enforcement';
import { settlementEngine } from '@/lib/settlement/SettlementEngine';

async function getVerifiedWireAccounts() {
  const raw = await db.ownerAccount.findMany({
    where: {
      isActive: true,
      verifiedAt: { not: null },
      accountType: { in: ['bank_wire', 'attijari', 'wise'] },
    },
    orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
  });
  if (raw.length === 0) {
    throw new Error(
      'NO_VERIFIED_OWNER_BANK_ACCOUNTS: Destinations come from OwnerAccount. Add isActive=true+verifiedAt rows via owner-accounts/seed.',
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
    isPrimary: a.isPrimary,
    sortOrder: a.sortOrder,
    maskIban: a.accountNumber ? `${a.accountNumber.slice(0, 4)}***${a.accountNumber.slice(-4)}` : '',
    maskAccount: a.accountNumber ? `***${a.accountNumber.slice(-4)}` : '',
  }));
  const primary = all.find((a) => a.isPrimary) || all[0];
  const secondary = all.find((a) => !a.isPrimary) || all[0];
  return { all, primary, secondary };
}

function maskAccount(val: string | null | undefined): string {
  if (!val) return '';
  if (val.length <= 8) return val.replace(/./g, '*');
  return `${val.slice(0, 4)}***${val.slice(-4)}`;
}

export async function GET(req: NextRequest) {
  const denied = requireOpsAuth(req);
  if (denied) return denied;
  try {
    const { all, primary, secondary } = await getVerifiedWireAccounts();
    return NextResponse.json({
      success: true,
      verifiedAccounts: all.map((a) => ({
        id: a.id,
        accountType: a.accountType,
        accountHolder: a.accountHolder,
        currency: a.currency,
        isPrimary: a.isPrimary,
        bankName: a.bankName,
        ibanMasked: a.maskIban,
        swiftMasked: maskAccount(a.swiftCode),
        countryCode: a.countryCode,
      })),
      primaryChoice: {
        id: primary.id,
        bankName: primary.bankName,
        ibanMasked: primary.maskIban,
        currency: primary.currency,
        isPrimary: true,
      },
      secondaryChoice: {
        id: secondary.id,
        bankName: secondary.bankName,
        ibanMasked: secondary.maskIban,
        currency: secondary.currency,
        isPrimary: false,
      },
    });
  } catch (e) {
    const msg = (e as Error)?.message || 'NO_VERIFIED_OWNER_BANK_ACCOUNTS';
    return NextResponse.json(
      { success: false, error: msg, verifiedAccounts: [] },
      { status: msg.includes('NO_VERIFIED') ? 412 : 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const denied = requireOpsAuth(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const fabricationCheck = killFabrication(body);
    if (fabricationCheck) return fabricationCheck;

    const { batchIds, account: accountChoice = 'secondary', ownerAccountId } = body;

    const { all, primary, secondary } = await getVerifiedWireAccounts();
    let chosen;
    if (ownerAccountId) chosen = all.find((a) => a.id === String(ownerAccountId));
    if (!chosen) chosen = accountChoice === 'primary' ? primary : secondary;

    const railKind: 'bank_wire' | 'attijari' | 'wise' =
      chosen.accountType === 'attijari' ? 'attijari' :
      chosen.accountType === 'wise' ? 'wise' : 'bank_wire';

    let batches;
    if (batchIds && Array.isArray(batchIds) && batchIds.length > 0) {
      batches = await db.payoutBatch.findMany({
        where: {
          id: { in: batchIds },
          paymentProvider: { in: ['bank_transfer', 'bank_wire', 'attijari', 'wise', null] },
        },
        include: { items: true, revenueEvents: true },
      });
    } else {
      batches = await db.payoutBatch.findMany({
        where: {
          OR: [{ paymentProvider: 'bank_transfer' }, { paymentProvider: 'bank_wire' }, { paymentProvider: 'attijari' }, { paymentProvider: 'wise' }],
          status: { in: ['approved', 'pending_approval', 'completed'] },
        },
        include: { items: true, revenueEvents: true },
      });
    }

    if (batches.length === 0) {
      return NextResponse.json({
        success: false,
        message: 'No bank wire batches found to submit',
        submitted: [],
        allVerifiedOwnerAccounts: all.map((a) => ({ id: a.id, bankName: a.bankName, currency: a.currency, isPrimary: a.isPrimary })),
      });
    }

    const submitted: Array<Record<string, unknown>> = [];
    const now = new Date();

    for (const batch of batches) {
      const itemsInBatch = batch.items || [];
      const revenueInBatch = (batch.revenueEvents || []);
      const perBatchResults: Array<Record<string, unknown>> = [];

      for (const item of itemsInBatch) {
        let revForItem = revenueInBatch.find((r: any) => {
          try {
            return Math.abs((r.amount?.toNumber ? r.amount.toNumber() : Number(r.amount)) - Number(item.amount)) < 0.01 &&
              String(r.currency || 'USD').toUpperCase() === String(item.currency || 'USD').toUpperCase();
          } catch { return false; }
        });
        let revId = revForItem?.id;
        if (!revId) {
          const candidates = await db.revenueEvent.findMany({
            where: { payoutBatchId: batch.id, status: { in: ['pending', 'verified', 'confirmed', 'reconciled'] } },
            take: 1,
            orderBy: { createdAt: 'asc' },
          });
          revId = candidates[0]?.id;
        }
        if (!revId) {
          const created = await db.revenueEvent.create({
            data: {
              source: 'payout_batch_item',
              referenceId: `${batch.id}:${item.id}`,
              amount: Number(item.amount),
              currency: String(item.currency || 'USD').toUpperCase(),
              status: 'reconciled',
              description: `Auto-created for wire submit batch ${batch.batchNumber} item ${item.id}`,
              payoutBatchId: batch.id,
              batchedAt: now,
            },
          });
          revId = created.id;
        }

        const idem = `wire_${batch.id}_${item.id}_${chosen.id}`;
        let seResult;
        try {
          seResult = await settlementEngine.submitForSettlement({
            revenueEventId: revId,
            ownerAccountId: chosen.id,
            entitlementSourceRef: `submit_wire:${batch.id}:${item.id}`,
            idempotencyKey: idem,
            amount: Number(item.amount),
            currency: String(item.currency || 'USD').toUpperCase(),
            railKind,
            actor: 'ops:submit-wire:POST',
            metadata: {
              payoutBatchId: batch.id,
              batchNumber: batch.batchNumber,
              payoutItemId: item.id,
              source: 'submit_wire_endpoint',
            },
          });
        } catch (se) {
          perBatchResults.push({ itemId: item.id, error: (se as Error).message });
          continue;
        }
        perBatchResults.push({
          itemId: item.id,
          payoutItemId: seResult.payoutItemId,
          state: seResult.state,
          idempotencyHit: seResult.idempotencyHit,
          amount: Number(item.amount),
          currency: String(item.currency || 'USD').toUpperCase(),
        });
      }

      try {
        await db.payoutBatch.update({
          where: { id: batch.id },
          data: {
            status: 'submitted',
            submittedAt: now,
            notes: `Wire submitted via verified OwnerAccount id=${chosen.id} (${chosen.bankName || chosen.accountType}) — ${perBatchResults.length} items routed through SettlementEngine. ${batch.notes || ''}`,
          },
        });
      } catch { /* ignore batch update race */ }

      submitted.push({
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        itemCount: itemsInBatch.length,
        totalAmount: Number(batch.totalAmount || 0),
        currency: batch.currency,
        ownerAccountId: chosen.id,
        rail: railKind,
        bankName: chosen.bankName,
        accountHolder: chosen.accountHolder,
        ibanMasked: chosen.maskIban,
        items: perBatchResults,
      });
    }

    await db.payoutAuditLog.create({
      data: {
        entityType: 'PayoutBatch',
        entityId: submitted.map((s: any) => s.batchId).join(','),
        action: 'wire_submitted_via_verified_owner_account',
        oldValue: 'status!=submitted',
        newValue: JSON.stringify({
          batches: submitted.length,
          ownerAccountId: chosen.id,
          railKind,
          bankName: chosen.bankName,
        }),
        reason: 'Owner-initiated wire transfer via verified OwnerAccount routing through SettlementEngine',
        performedBy: 'ops:submit-wire',
      },
    });

    const totalAmount = submitted.reduce((s, r: any) => s + (r.totalAmount || 0), 0);
    const totalItems = submitted.reduce((s, r: any) => s + (r.itemCount || 0), 0);

    return NextResponse.json({
      success: true,
      message: `${submitted.length} wire batch(es) queued via SettlementEngine to verified OwnerAccount id=${chosen.id} (${chosen.bankName || chosen.accountType})`,
      submitted,
      submittedTo: {
        ownerAccountId: chosen.id,
        bankName: chosen.bankName,
        accountHolder: chosen.accountHolder,
        ibanMasked: chosen.maskIban,
        swiftMasked: maskAccount(chosen.swiftCode),
        currency: chosen.currency,
        accountType: chosen.accountType,
      },
      allVerifiedOwnerAccounts: all.map((a) => ({
        id: a.id,
        bankName: a.bankName,
        accountHolder: a.accountHolder,
        ibanMasked: a.maskIban,
        currency: a.currency,
        isPrimary: a.isPrimary,
        accountType: a.accountType,
      })),
      summary: {
        batches: submitted.length,
        totalAmount,
        totalItems,
        submittedAt: now.toISOString(),
      },
    });
  } catch (err) {
    const msg = (err as Error)?.message || 'Internal server error';
    const status = /NO_VERIFIED/.test(msg) ? 412 : 500;
    console.error('[submit-wire] Error:', err);
    return NextResponse.json(
      { success: false, error: msg, submitted: [] },
      { status },
    );
  }
}
