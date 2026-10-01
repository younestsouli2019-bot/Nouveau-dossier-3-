import { NextRequest, NextResponse } from 'next/server';
import { readOrders } from '@/lib/rwc-order-ledger';

/**
 * GET /api/orders?limit=50
 *
 * Owner view over the course-order ledger. Guarded by x-ops-secret or
 * OPS_SECRET matching the repo's existing operator-token pattern.
 * Read-only: order records are never modified through this route.
 */
export async function GET(request: NextRequest) {
  const provided =
    request.headers.get('x-ops-secret') ??
    (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '') ??
    '';
  const expected = process.env.OPS_SECRET ?? '';
  if (!expected || provided !== expected) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const limitParam = Number(new URL(request.url).searchParams.get('limit'));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 50;
  const orders = await readOrders(limit);

  const revenue = orders
    .filter((o) => o.status === 'PAID')
    .reduce((sum, o) => sum + (o.amount_total || 0), 0);

  return NextResponse.json({
    success: true,
    count: orders.length,
    paid_revenue_total: Math.round(revenue * 100) / 100,
    pending_delivery: orders.filter((o) => o.delivery === 'PENDING').length,
    orders: orders.slice().reverse(),
  });
}
