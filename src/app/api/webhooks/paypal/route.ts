import { NextRequest, NextResponse } from 'next/server';
import { accessToken, apiBase, isPayPalConfigured } from '@/lib/paypal-checkout';
import { fulfilPayPalOrder } from '@/lib/paypal-fulfil';

export const runtime = 'nodejs';

/**
 * POST /api/webhooks/paypal
 * Backup path for a buyer who pays but never returns (closed window).
 * The payload is verified with PayPal's signature endpoint, then the order is
 * re-read from the API and checked before fulfilment — never trusted as-is.
 */
export async function POST(request: NextRequest) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId || !isPayPalConfigured()) {
    return NextResponse.json({ error: 'webhook_not_configured' }, { status: 503 });
  }

  let event: any;
  try {
    event = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const token = await accessToken();
  const verifyRes = await fetch(`${apiBase()}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_algo: request.headers.get('paypal-auth-algo'),
      cert_url: request.headers.get('paypal-cert-url'),
      transmission_id: request.headers.get('paypal-transmission-id'),
      transmission_sig: request.headers.get('paypal-transmission-sig'),
      transmission_time: request.headers.get('paypal-transmission-time'),
      webhook_id: webhookId,
      webhook_event: event,
    }),
    cache: 'no-store',
  });
  const verdict = (await verifyRes.json()) as { verification_status?: string };
  if (verdict.verification_status !== 'SUCCESS') {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 400 });
  }

  if (event?.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
    const orderId = event?.resource?.supplementary_data?.related_ids?.order_id;
    if (!orderId) return NextResponse.json({ ok: true, note: 'no_order_id' });
    const result = await fulfilPayPalOrder(String(orderId));
    if (!result.ok) {
      // 500 so PayPal retries; fulfilment is idempotent.
      return NextResponse.json({ error: result.reason ?? 'fulfil_failed' }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: true });
}
