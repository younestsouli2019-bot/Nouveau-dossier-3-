import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const source = searchParams.get('source');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const skip = (page - 1) * limit;

    const where: Record<string, string> = {};
    if (status) where.status = status;
    if (source) where.source = source;

    const [events, total] = await Promise.all([
      db.revenueEvent.findMany({
        where: Object.keys(where).length > 0 ? where : undefined,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      db.revenueEvent.count({
        where: Object.keys(where).length > 0 ? where : undefined,
      }),
    ]);

    return NextResponse.json({ events, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Revenue events API error:', error);
    return NextResponse.json({ error: 'Failed to load revenue events' }, { status: 500 });
  }
}