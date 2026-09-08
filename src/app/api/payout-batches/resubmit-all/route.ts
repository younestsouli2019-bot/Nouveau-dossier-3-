import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { requireOpsAuth } from '@/lib/api-auth';
import { settlementEngine } from '@/lib/settlement/SettlementEngine';

interface VerifiedAccounts {
  paypal?: { id: string; accountHolder: string; paypalEmail?: string | null; currency: string; isPrimary?: boolean };
  payoneer?: { id: string; accountHolder: string; payoneerMask: string; currency: string; isPrimary?: boolean; payoneerId?: string; wiseEmail?: string | null };
  bank_wire?: { id: string; accountHolder: string; bankName?: string | null; accountNumber?: string | null; swiftCode?: string | null; currency: string; isPrimary?: boolean; accountType?: string };
  all: Array<{ id: string; accountType?: string | null; accountHolder?: string | null; currency?: string | null; isPrimary: boolean; bankName?: string | null; hasPaypal: boolean; hasPayoneer: boolean; ibanMasked?: string; paypalMasked?: string }>;
}

type RailKind = 'paypal' | 'bank_wire' | 'crypto' | 'payoneer' | 'wise' | 'stripe' | 'tron' | 'google_pay' | 'attijari';

async function getVerifiedAccounts(): Promise<VerifiedAccounts> {
  const raw = await db.ownerAccount.findMany({
    where: { isActive: true, verifiedAt: { not: null } },
    orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
  });
  if (raw.length === 0) {
    throw new Error('NO_VERIFIED_OWNER_ACCOUNTS: Destinations come from OwnerAccount (isActive=true + verifiedAt IS NOT NULL).');
  }
  const out: VerifiedAccounts = { all: [] };
  for (const a of raw) {
    const common = {
      id: a.id,
      accountHolder: a.accountHolder || 'Owner',
      currency: a.currency || 'USD',
      isPrimary: a.isPrimary,
    };
    if (a.paypalEmail && !out.paypal) {
      out.paypal = { ...common, paypalEmail: a.paypalEmail };
    }
    if ((a.wiseEmail || a.payoneerId) && !out.payoneer) {
      out.payoneer = { ...common, payoneerMask: a.wiseEmail || `payoneer-${(a.payoneerId || '').slice(-4) || '****'}`, payoneerId: a.payoneerId, wiseEmail: a.wiseEmail };
    }
    const bankTypes = ['bank_wire', 'attijari', 'wise'];
    if (a.accountType && bankTypes.includes(a.accountType) && !out.bank_wire) {
      out.bank_wire = {
        ...common,
        bankName: a.bankName,
        accountNumber: a.accountNumber,
        swiftCode: a.swiftCode,
        accountType: a.accountType,
      };
    }
    out.all.push({
      id: a.id,
      accountType: a.accountType,
      accountHolder: a.accountHolder,
      currency: a.currency,
      isPrimary: a.isPrimary,
      bankName: a.bankName,
      hasPaypal: !!a.paypalEmail,
      hasPayoneer: !!(a.wiseEmail || a.payoneerId),
      ibanMasked: a.accountNumber ? `${a.accountNumber.slice(0, 4)}***${a.accountNumber.slice(-4)}` : undefined,
      paypalMasked: a.paypalEmail ? `***${a.paypalEmail.slice(-10)}` : undefined,
    });
  }
  return out;
}

function pickRailAndOwner(method: string, acc: VerifiedAccounts): { rail: RailKind; ownerAccountId: string } {
  const m = String(method || '').toLowerCase();
  if (m === 'paypal' && acc.paypal) return { rail: 'paypal', ownerAccountId: acc.paypal.id };
  if (m === 'payoneer' && acc.payoneer) return { rail: 'payoneer', ownerAccountId: acc.payoneer.id };
  if (['bank_transfer', 'bank_wire', 'wire', 'attijari', 'wise'].includes(m) && acc.bank_wire) {
    if (m === 'attijari') return { rail: 'attijari', ownerAccountId: acc.bank_wire.id };
    if (m === 'wise') return { rail: 'wise', ownerAccountId: acc.bank_wire.id };
    return { rail: 'bank_wire', ownerAccountId: acc.bank_wire.id };
  }
  if (m.startsWith('crypto')) {
    const fb = acc.paypal || acc.payoneer || acc.bank_wire;
    if (fb) return { rail: 'tron', ownerAccountId: fb.id };
  }
  if (acc.paypal) return { rail: 'paypal', ownerAccountId: acc.paypal.id };
  if (acc.payoneer) return { rail: 'payoneer', ownerAccountId: acc.payoneer.id };
  if (acc.bank_wire) return { rail: 'bank_wire', ownerAccountId: acc.bank_wire.id };
  throw new Error('NO_VERIFIED_OWNER_ACCOUNT_FOR_METHOD');
}

export async function GET(req: NextRequest) {
  const denied = requireOpsAuth(req);
  if (denied) return denied;
  try {
    const acc = await getVerifiedAccounts();
    return NextResponse.json({
      success: true,
      hasVerifiedPaypal: !!acc.paypal,
      hasVerifiedPayoneer: !!acc.payoneer,
      hasVerifiedBank: !!acc.bank_wire,
      allVerifiedOwnerAccounts: acc.all,
    });
  } catch (e) {
    const msg = (e as Error)?.message || 'NO_VERIFIED_OWNER_ACCOUNTS';
    return NextResponse.json(
      { success: false, error: msg, allVerifiedOwnerAccounts: [] },
      { status: msg.includes('NO_VERIFIED') ? 412 : 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const denied = requireOpsAuth(request);
  if (denied) return denied;
  try {
    const body = await request.json().catch(() => ({}));
    const { batchIds, methodsFilter } = body || {};

    const acc = await getVerifiedAccounts();

    const whereAny: any = {
      status: { in: ['completed', 'approved', 'processing', 'submitted_to_paypal', 'pending_approval', 'submitted'] },
    };
    if (batchIds && Array.isArray(batchIds) && batchIds.length) {
      whereAny.id = { in: batchIds };
    }
    const allBatches = await db.payoutBatch.findMany({
      where: whereAny,
      include: { items: true, revenueEvents: true },
    });

    if (allBatches.length === 0) {
      return NextResponse.json({
        success: false,
        message: 'No outstanding batches to resubmit',
        submitted: [],
        allVerifiedOwnerAccounts: acc.all,
      });
    }

    const results: Array<Record<string, unknown>> = [];
    const now = new Date();

    for (const batch of allBatches) {
      const items: Array<any> = batch.items || [];
      const batchProvider = batch.paymentProvider;
      const revs: Array<any> = batch.revenueEvents || [];
      const singleIsPure = batchProvider && !['wire_transfer', 'mixed', null, undefined].includes(batchProvider) && methodsFilter == null;

      if (singleIsPure) {
        const { rail, ownerAccountId } = pickRailAndOwner(String(batchProvider), acc);
        let revId = revs[0]?.id;
        if (!revId) {
          const cands = await db.revenueEvent.findMany({
            where: { payoutBatchId: batch.id },
            orderBy: { createdAt: 'asc' },
            take: 1,
          });
          revId = cands[0]?.id;
        }
        if (!revId) {
          const itemsSum = items.reduce<number>((s, i: any) => s + Number(i.amount || 0), 0);
          const created = await db.revenueEvent.create({
            data: {
              source: 'resubmit_batch',
              referenceId: String(batch.id),
              amount: Number(batch.totalAmount || itemsSum),
              currency: String(batch.currency || items[0]?.currency || 'USD').toUpperCase(),
              status: 'reconciled',
              description: `Auto-created for resubmit batch ${batch.batchNumber}`,
              payoutBatchId: batch.id,
              batchedAt: now,
            },
          });
          revId = created.id;
        }

        const idem = `resub_${batch.id}_${ownerAccountId}_${now.getTime()}`;
        let se;
        try {
          se = await settlementEngine.submitForSettlement({
            revenueEventId: revId,
            ownerAccountId,
            entitlementSourceRef: `resubmit_all:${batch.id}`,
            idempotencyKey: idem,
            amount: Number(batch.totalAmount || 0),
            currency: String(batch.currency || items[0]?.currency || 'USD').toUpperCase(),
            railKind: rail,
            actor: 'ops:resubmit-all:POST',
            metadata: {
              payoutBatchId: batch.id,
              batchNumber: batch.batchNumber,
              source: 'resubmit_all_endpoint',
              batchProvider,
            },
          });
        } catch (serr) {
          results.push({ batchId: batch.id, batchNumber: batch.batchNumber, error: (serr as Error).message });
          continue;
        }

        await db.payoutBatch.update({
          where: { id: batch.id },
          data: {
            status: 'submitted',
            submittedAt: now,
            notes: `Resubmitted via verified OwnerAccount id=${ownerAccountId} (${rail}) routed through SettlementEngine idempotencyHit=${se.idempotencyHit}. Previous completion was unverified. ${batch.notes || ''}`,
          },
        }).catch(() => {});

        results.push({
          batchId: batch.id,
          batchNumber: batch.batchNumber,
          method: batchProvider,
          amount: Number(batch.totalAmount || 0),
          items: items.length,
          payoutItemId: se.payoutItemId,
          state: se.state,
          idempotencyHit: se.idempotencyHit,
          ownerAccountId,
          rail,
        });
      } else {
        const byMethod: Record<string, typeof items> = {};
        for (const item of items) {
          const m = item.paymentMethod || batchProvider || 'bank_transfer';
          if (!byMethod[m]) byMethod[m] = [];
          byMethod[m].push(item);
        }

        for (const [method, mitems] of Object.entries<any[]>(byMethod)) {
          if (methodsFilter && Array.isArray(methodsFilter) && !methodsFilter.includes(method)) {
            continue;
          }
          const total = mitems.reduce<number>((s, i: any) => s + Number(i.amount || 0), 0);
          const { rail, ownerAccountId } = pickRailAndOwner(String(method), acc);
          let firstRevId = revs.find((r: any) => {
            try { return Math.abs(Number(r.amount) - total) < 0.01; } catch { return false; }
          })?.id;
          if (!firstRevId) {
            const cands = await db.revenueEvent.findMany({
              where: { payoutBatchId: batch.id },
              orderBy: { createdAt: 'asc' },
              take: 1,
            });
            firstRevId = cands[0]?.id;
          }
          if (!firstRevId) {
            const created = await db.revenueEvent.create({
              data: {
                source: 'resubmit_batch_itemgroup',
                referenceId: `${batch.id}:${method}`,
                amount: total,
                currency: String(batch.currency || mitems[0]?.currency || 'USD').toUpperCase(),
                status: 'reconciled',
                description: `Auto for resubmit ${batch.batchNumber} method=${method}`,
                payoutBatchId: batch.id,
                batchedAt: now,
              },
            });
            firstRevId = created.id;
          }
          const idemPart = `resub_${batch.id}_${method}_${ownerAccountId}_${now.getTime()}_${Math.random().toString(36).slice(2, 6)}`;
          let sePart;
          try {
            sePart = await settlementEngine.submitForSettlement({
              revenueEventId: firstRevId,
              ownerAccountId,
              entitlementSourceRef: `resubmit_all:${batch.id}:${method}`,
              idempotencyKey: idemPart,
              amount: total,
              currency: String(batch.currency || mitems[0]?.currency || 'USD').toUpperCase(),
              railKind: rail,
              actor: 'ops:resubmit-all:POST',
              metadata: {
                payoutBatchId: batch.id,
                batchNumber: batch.batchNumber,
                source: 'resubmit_all_endpoint',
                method,
                payoutItemIds: mitems.map((x: any) => x.id),
              },
            });
          } catch (serr) {
            results.push({ batchId: batch.id, batchNumber: batch.batchNumber, method, error: (serr as Error).message });
            continue;
          }
          results.push({
            batchId: batch.id,
            batchNumber: batch.batchNumber,
            method,
            amount: total,
            items: mitems.length,
            payoutItemId: sePart.payoutItemId,
            state: sePart.state,
            idempotencyHit: sePart.idempotencyHit,
            ownerAccountId,
            rail,
            partial: true,
          });
        }

        const methodsDone = Object.keys(byMethod);
        db.payoutBatch.update({
          where: { id: batch.id },
          data: {
            status: 'submitted',
            submittedAt: now,
            paymentProvider: methodsDone.length === 1 ? methodsDone[0] : 'mixed',
            notes: `Resubmitted via verified OwnerAccounts (${methodsDone.length} providers: ${methodsDone.join(', ')}) routed through SettlementEngine. ${batch.notes || ''}`,
          },
        }).catch(() => {});
      }
    }

    db.payoutAuditLog.create({
      data: {
        entityType: 'PayoutBatch',
        entityId: allBatches.map((b) => b.id).join(','),
        action: 'resubmit_all_via_verified_owner_accounts',
        oldValue: 'status=previous',
        newValue: JSON.stringify({ submissions: results.length }),
        reason: 'Resubmitted all outstanding batches via verified OwnerAccount destinations routed through SettlementEngine.',
        performedBy: 'ops:resubmit-all',
      },
    }).catch(() => {});

    const byMethod: Record<string, { count: number; amount: number }> = {};
    for (const r of results) {
      if (!r.method || (r as any).error) continue;
      const m = String((r as any).method);
      if (!byMethod[m]) byMethod[m] = { count: 0, amount: 0 };
      byMethod[m].count++;
      byMethod[m].amount += Number((r as any).amount || 0);
    }
    const totalAmount = Object.values(byMethod).reduce((s, v) => s + v.amount, 0);
    const totalItems = results.filter((r) => !(r as any).error).reduce<number>((s, r: any) => s + (r.items || 0), 0);
    const errorCount = results.filter((r) => (r as any).error).length;

    return NextResponse.json({
      success: true,
      message: `${allBatches.length} batch(es) processed — ${results.length - errorCount} submission(s) routed through SettlementEngine via verified OwnerAccounts`,
      byMethod,
      submitted: results,
      allVerifiedOwnerAccounts: acc.all,
      summary: {
        batches: results.length,
        errorCount,
        totalAmount,
        totalItems,
        submittedAt: now.toISOString(),
      },
    });
  } catch (err: any) {
    const msg = err?.message || 'Internal server error';
    const status = /NO_VERIFIED/.test(msg) ? 412 : 500;
    console.error('[resubmit-all] Error:', err);
    return NextResponse.json(
      { success: false, error: msg, submitted: [] },
      { status },
    );
  }
}
