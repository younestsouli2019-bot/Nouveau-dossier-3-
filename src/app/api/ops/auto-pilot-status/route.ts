import { db } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const [runs, totalItems, completedItems, pendingItems, failedItems, processingItems, autoApprovedBatches, autoProcessedBatches] = await Promise.all([
      db.autoPilotRun.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
      db.payoutItem.count(),
      db.payoutItem.count({ where: { status: 'completed' } }),
      db.payoutItem.count({ where: { status: 'pending' } }),
      db.payoutItem.count({ where: { status: 'failed' } }),
      db.payoutItem.count({ where: { status: 'processing' } }),
      db.payoutBatch.count({ where: { autoApproved: true } }),
      db.payoutBatch.count({ where: { autoProcessed: true } }),
    ]);

    const lastRun = runs.length > 0 ? runs[0] : null;

    return NextResponse.json({
      lastRun,
      runs,
      summary: {
        totalItems,
        completedItems,
        pendingItems,
        failedItems,
        processingItems,
        autoApprovedBatches,
        autoProcessedBatches,
        completionRate: totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0,
      },
    });
  } catch (error) {
    console.error('[GET /api/ops/auto-pilot-status] Error:', error);
    return NextResponse.json({ error: 'Failed to load auto-pilot status' }, { status: 500 });
  }
}