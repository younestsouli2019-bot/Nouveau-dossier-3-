import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Total received / sent across owners
    const ownerSum: any[] = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COALESCE(SUM("totalReceived"::float),0)::float AS tr, COALESCE(SUM("totalSent"::float),0)::float AS ts,
              COALESCE(SUM("heldBalance"::float),0)::float AS held, COALESCE(SUM("spendableBalance"::float),0)::float AS spend
       FROM "OwnerAccount";`,
    ).catch(() => [] as any[]);
    const r = ownerSum[0] || {};

    // RWC audit rows (sales ingested) with last 10 ordered by createdAt desc
    const rwcSaleCount = await prisma.auditLedger.count({ where: { action: 'rwc_sale_received' } }).catch(() => 0);
    const lastRwc = await prisma.auditLedger.findMany({
      where: { action: 'rwc_sale_received' },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, createdAt: true, entityId: true, metadata: true },
    }).catch(() => []);

    // PO delivered
    const poDelivered = await prisma.purchaseOrder.count({
      where: { status: { in: ['delivered', 'receipt_confirmed', 'settled'] as any } },
    }).catch(() => 0);
    const poSum: any[] = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COALESCE(SUM("totalAmount"::float),0)::float AS total FROM "PurchaseOrder" WHERE status::text IN ('delivered','receipt_confirmed','settled');`,
    ).catch(() => [] as any[]);

    // Settlements completed
    const osComp = await prisma.ownerSettlement.count({ where: { status: 'completed' } }).catch(() => 0);
    const osSum: any[] = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COALESCE(SUM("amount"::float),0)::float AS total FROM "OwnerSettlement" WHERE status='completed';`,
    ).catch(() => [] as any[]);
    const piComp = await prisma.payoutItem.count({ where: { status: 'completed' } }).catch(() => 0);

    const safeNum = (n: any) => Number(n || 0).toFixed(2);

    return NextResponse.json({
      status: 'ok',
      updatedAt: new Date().toISOString(),
      treasury: {
        totalReceivedUsd: Number(safeNum(r.tr)),
        totalSentUsd: Number(safeNum(r.ts)),
        heldBalanceUsd: Number(safeNum(r.held)),
        spendableBalanceUsd: Number(safeNum(r.spend)),
      },
      settlements: {
        completedCount: Number(osComp),
        completedTotalUsd: Number(safeNum((osSum as any)[0]?.total || 0)),
        payoutItemsCompleted: Number(piComp),
      },
      purchaseOrders: {
        deliveredOrSettledCount: Number(poDelivered),
        deliveredTotalValueUsd: Number(safeNum((poSum as any)[0]?.total || 0)),
      },
      realWorldCerts: {
        salesIngestedCount: Number(rwcSaleCount),
        last10Sales: lastRwc.map(x => ({
          id: x.id,
          at: x.createdAt.toISOString(),
          bucketOwner: x.entityId,
          meta: (() => { try { return JSON.parse(x.metadata as any); } catch { return x.metadata; } })(),
        })),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ status: 'error', error: e.message }, { status: 500 });
  }
}
