import { db } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const [
      totalRevenue,
      confirmedRevenue,
      reconciledRevenue,
      pendingRevenue,
      revenueBySource,
      totalBatches,
      pendingApprovalBatches,
      totalPayoutItems,
      pendingItems,
      processingItems,
      failedItems,
      completedItems,
      unclaimedItems,
      recentRevenueEvents,
      recentBatches,
      paypalBatches,
      unbatchedRevenue,
      confirmedReceived,
      awaitingConfirmation,
    ] = await Promise.all([
      db.revenueEvent.aggregate({ _sum: { amount: true } }),
      db.revenueEvent.aggregate({ where: { status: 'confirmed' }, _sum: { amount: true }, _count: true }),
      db.revenueEvent.aggregate({ where: { status: 'reconciled' }, _sum: { amount: true }, _count: true }),
      db.revenueEvent.aggregate({ where: { status: 'pending' }, _sum: { amount: true }, _count: true }),
      db.revenueEvent.groupBy({ by: ['source'], _sum: { amount: true }, _count: true }),
      db.payoutBatch.count(),
      db.payoutBatch.count({ where: { status: 'pending_approval' } }),
      db.payoutItem.count(),
      db.payoutItem.aggregate({ where: { status: 'pending' }, _sum: { amount: true }, _count: true }),
      db.payoutItem.aggregate({ where: { status: 'processing' }, _sum: { amount: true }, _count: true }),
      db.payoutItem.aggregate({ where: { status: 'failed' }, _sum: { amount: true }, _count: true }),
      db.payoutItem.aggregate({ where: { status: 'completed' }, _sum: { amount: true }, _count: true }),
      db.payoutItem.aggregate({ where: { status: 'unclaimed' }, _sum: { amount: true }, _count: true }),
      db.revenueEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 8 }),
      db.payoutBatch.findMany({ orderBy: { createdAt: 'desc' }, take: 6 }),
      db.payoutBatch.aggregate({ where: { status: 'submitted_to_paypal' }, _sum: { totalAmount: true }, _count: true }),
      db.revenueEvent.aggregate({ where: { status: 'confirmed', payoutBatchId: null }, _sum: { amount: true }, _count: true }),
      // KEY: Confirmed RECEIVED vs Awaiting Confirmation
      db.payoutItem.aggregate({ where: { status: 'completed', deliveryConfirmed: true }, _sum: { amount: true }, _count: true }),
      db.payoutItem.aggregate({ where: { status: 'completed', deliveryConfirmed: { not: true } }, _sum: { amount: true }, _count: true }),
    ]);

    const totalPayoutAmount = await db.payoutItem.aggregate({ _sum: { amount: true } });
    const completedPayoutAmount = await db.payoutItem.aggregate({ where: { status: 'completed' }, _sum: { amount: true } });

    const batchStatusCounts = await db.payoutBatch.groupBy({
      by: ['status'],
      _count: true,
      _sum: { totalAmount: true },
    });

    const itemStatusCounts = await db.payoutItem.groupBy({
      by: ['status'],
      _count: true,
      _sum: { amount: true },
    });

    return NextResponse.json({
      revenue: {
        total: totalRevenue._sum.amount || 0,
        confirmed: { amount: confirmedRevenue._sum.amount || 0, count: confirmedRevenue._count },
        reconciled: { amount: reconciledRevenue._sum.amount || 0, count: reconciledRevenue._count },
        pending: { amount: pendingRevenue._sum.amount || 0, count: pendingRevenue._count },
        unbatched: { amount: unbatchedRevenue._sum.amount || 0, count: unbatchedRevenue._count },
        bySource: revenueBySource.map((s) => ({
          source: s.source,
          amount: s._sum.amount || 0,
          count: s._count,
        })),
      },
      payouts: {
        totalBatches,
        pendingApprovalBatches,
        paypalBatches: { amount: paypalBatches._sum.totalAmount || 0, count: paypalBatches._count },
        totalItems: totalPayoutItems,
        pendingItems: { amount: pendingItems._sum.amount || 0, count: pendingItems._count },
        processingItems: { amount: processingItems._sum.amount || 0, count: processingItems._count },
        failedItems: { amount: failedItems._sum.amount || 0, count: failedItems._count },
        completedItems: { amount: completedItems._sum.amount || 0, count: completedItems._count },
        unclaimedItems: { amount: unclaimedItems._sum.amount || 0, count: unclaimedItems._count },
        confirmedReceived: { amount: confirmedReceived._sum.amount || 0, count: confirmedReceived._count },
        awaitingConfirmation: { amount: awaitingConfirmation._sum.amount || 0, count: awaitingConfirmation._count },
        totalAmount: totalPayoutAmount._sum.amount || 0,
        completedAmount: completedPayoutAmount._sum.amount || 0,
        batchStatusDistribution: batchStatusCounts.map((b) => ({
          status: b.status,
          count: b._count,
          amount: b._sum.totalAmount || 0,
        })),
        itemStatusDistribution: itemStatusCounts.map((i) => ({
          status: i.status,
          count: i._count,
          amount: i._sum.amount || 0,
        })),
      },
      recent: {
        revenueEvents: recentRevenueEvents,
        batches: recentBatches,
      },
    });
  } catch (error) {
    console.error('Dashboard API error:', error);
    return NextResponse.json({ error: 'Failed to load dashboard data' }, { status: 500 });
  }
}