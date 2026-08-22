import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    const where: Record<string, unknown> = {};
    if (category) where.category = category;
    if (status) where.status = status;

    const logs = await db.transactionLog.findMany({
      where,
      orderBy: { transactionDate: 'desc' },
      take: limit,
      include: {
        payoutBatch: { select: { batchNumber: true, status: true } },
      },
    });

    // Summary stats
    const [total, completed, failed, pending, orphanCount] = await Promise.all([
      db.transactionLog.count(),
      db.transactionLog.count({ where: { status: 'completed' } }),
      db.transactionLog.count({ where: { status: 'failed' } }),
      db.transactionLog.count({ where: { status: 'pending' } }),
      db.transactionLog.count({ where: { category: 'withdrawal', payoutItemId: null } }),
    ]);

    const totalAmount = await db.transactionLog.aggregate({ _sum: { amount: true } });
    const completedAmount = await db.transactionLog.aggregate({ where: { status: 'completed' }, _sum: { amount: true } });

    return NextResponse.json({
      logs: logs.map((log) => ({
        id: log.id,
        category: log.category,
        status: log.status,
        amount: log.amount,
        currency: log.currency,
        transactionDate: log.transactionDate.toISOString(),
        referenceId: log.referenceId,
        description: log.description,
        payoutBatchId: log.payoutBatchId,
        payoutItemId: log.payoutItemId,
        provider: log.provider,
        providerTxId: log.providerTxId,
        errorCode: log.errorCode,
        errorMessage: log.errorMessage,
        batchNumber: log.payoutBatch?.batchNumber || null,
        batchStatus: log.payoutBatch?.status || null,
      })),
      summary: {
        total,
        completed,
        failed,
        pending,
        orphanCount,
        totalAmount: totalAmount._sum.amount || 0,
        completedAmount: completedAmount._sum.amount || 0,
      },
    });
  } catch (error) {
    console.error('Transaction log API error:', error);
    return NextResponse.json({ error: 'Failed to load transaction logs' }, { status: 500 });
  }
}