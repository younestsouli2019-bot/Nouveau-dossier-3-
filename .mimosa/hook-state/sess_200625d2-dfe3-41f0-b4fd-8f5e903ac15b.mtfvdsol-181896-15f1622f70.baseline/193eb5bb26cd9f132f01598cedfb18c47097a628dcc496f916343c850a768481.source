import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const skip = (page - 1) * limit;

    const where: Record<string, string> = {};
    if (status) where.status = status;

    const [batches, total] = await Promise.all([
      db.payoutBatch.findMany({
        where: Object.keys(where).length > 0 ? where : undefined,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          _count: {
            select: { items: true },
          },
        },
      }),
      db.payoutBatch.count({
        where: Object.keys(where).length > 0 ? where : undefined,
      }),
    ]);

    // Get item status breakdown for each batch
    const batchIds = batches.map((b) => b.id);
    const itemBreakdowns = batchIds.length > 0
      ? await db.payoutItem.groupBy({
          by: ['payoutBatchId', 'status'],
          where: { payoutBatchId: { in: batchIds } },
          _count: true,
        })
      : [];

    const enrichedBatches = batches.map((batch) => {
      const breakdown = itemBreakdowns
        .filter((ib) => ib.payoutBatchId === batch.id)
        .reduce((acc, ib) => {
          acc[ib.status] = ib._count;
          return acc;
        }, {} as Record<string, number>);

      return {
        ...batch,
        itemCount: batch._count.items,
        itemBreakdown: breakdown,
      };
    });

    return NextResponse.json({ batches: enrichedBatches, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Payout batches API error:', error);
    return NextResponse.json({ error: 'Failed to load payout batches' }, { status: 500 });
  }
}