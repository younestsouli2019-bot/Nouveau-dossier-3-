import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const hasKeys = !!(process.env.BYBIT_API_KEY && process.env.BYBIT_API_SECRET);

  if (!hasKeys) {
    return NextResponse.json({
      status: 'not_configured',
      message: 'BYBIT_API_KEY and BYBIT_API_SECRET env vars not set. Add them to Vercel to activate.',
      timestamp: new Date().toISOString(),
    });
  }

  try {
    const { healthCheck } = await import('@/lib/bybit');
    const health = await Promise.race([
      healthCheck(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000)),
    ]);
    return NextResponse.json({
      status: health.ok ? 'connected' : 'degraded',
      serverTime: health.serverTime,
      reason: health.ok ? undefined : health.reason,
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json({ status: 'unreachable', error: e.message, hint: 'Bybit testnet may be blocked from Vercel. Add BYBIT_API_KEY/SECRET to Vercel env vars.' }, { status: 200 });
  }
}

export async function POST(request: Request) {
  const hasKeys = !!(process.env.BYBIT_API_KEY && process.env.BYBIT_API_SECRET);

  if (!hasKeys) {
    return NextResponse.json({
      error: 'BYBIT_API_KEY and BYBIT_API_SECRET not configured',
      hint: 'Add them to Vercel env vars to enable trading',
    }, { status: 503 });
  }

  try {
    const { getTicker, placeOrder, getWalletBalance } = await import('@/lib/bybit');
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
