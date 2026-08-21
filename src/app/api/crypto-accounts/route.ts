import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const settlements = await db.cryptoSettlement.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const totalAgg = await db.cryptoSettlement.aggregate({
      _sum: { amount: true },
      _count: true,
    });

    const byNetwork = await db.cryptoSettlement.groupBy({
      by: ['network'],
      _count: true,
      _sum: { amount: true },
    });

    const byStatus = await db.cryptoSettlement.groupBy({
      by: ['status'],
      _count: true,
    });

    return NextResponse.json({
      settlements,
      summary: {
        totalSettlements: totalAgg._count,
        totalVolumeUsd: totalAgg._sum.amount ?? 0,
        byNetwork: byNetwork.map(n => ({
          network: n.network,
          count: n._count,
          volume: n._sum.amount ?? 0,
        })),
        byStatus: byStatus.map(s => ({
          status: s.status,
          count: s._count,
        })),
      },
    });
  } catch (error) {
    console.error('Crypto accounts API error:', error);
    return NextResponse.json(
      { error: 'Failed to load crypto settlements', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 },
    );
  }
}
