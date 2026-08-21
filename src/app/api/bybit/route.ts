import { NextResponse } from 'next/server';
import { getWalletBalance, getTicker, placeOrder, healthCheck } from '@/lib/bybit';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [health, balance] = await Promise.all([healthCheck(), getWalletBalance()]);
    return NextResponse.json({
      status: health.ok ? 'connected' : 'degraded',
      serverTime: health.serverTime,
      balance: balance?.result?.list?.[0] || null,
      timestamp: new Date().toISOString()
    });
  } catch (e: any) {
    return NextResponse.json({ status: 'error', error: e.message }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, symbol, side, qty, price } = body;

    switch (action) {
      case 'ticker':
        const ticker = await getTicker(symbol);
        return NextResponse.json({ ok: true, ticker: ticker?.result?.list?.[0] });

      case 'order':
        const order = await placeOrder(symbol, side, qty, price);
        return NextResponse.json({ ok: true, orderId: order?.result?.orderId });

      case 'balance':
        const bal = await getWalletBalance();
        return NextResponse.json({ ok: true, balance: bal?.result?.list?.[0] });

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
