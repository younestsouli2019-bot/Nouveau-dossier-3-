import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { appendOrder, findOrderBySession } from '@/lib/rwc-order-ledger';
import { sendCourseReceipt } from '@/lib/rwc-delivery';

/**
 * POST /api/webhooks/stripe
 *
 * Receives Stripe webhooks (configure the endpoint for event
 * `checkout.session.completed`). Fail-closed:
 *  - STRIPE_WEBHOOK_SECRET missing → 503 (Stripe will retry later).
 *  - Signature mismatch → 400 (never process unsigned payloads).
 *  - Idempotent: a session already in the ledger is skipped.
 *
 * On checkout.session.completed the order is appended to the ledger
 * (data/out/course-orders.ndjson) with delivery status:
 *  - SENT     receipt email accepted by the provider (RESEND_API_KEY set)
 *  - PENDING  email not configured yet — order recorded, replayable via
 *             `node scripts/rwc-flush-pending-deliveries.mjs`
 * Always 200 after recording, so Stripe stops retrying.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Stripe webhook not configured' }, { status: 503 });
  }

  const signatureHeader = request.headers.get('stripe-signature') ?? '';
  const payload = await request.text();

  let valid = false;
  try {
    const parts = Object.fromEntries(
      signatureHeader.split(',').map((kv) => kv.split('=').map((x) => x.trim()) as [string, string]),
    );
    const t = parts.t ?? '';
    const v1 = parts.v1 ?? '';
    const expected = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
    const a = Buffer.from(v1, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    valid = a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
    // Replay window: reject signatures older than 5 minutes
    if (valid && t) {
      const age = Math.abs(Date.now() / 1000 - Number(t));
      if (!Number.isFinite(age) || age > 300) valid = false;
    }
  } catch {
    valid = false;
  }
  if (!valid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  let event: { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  if (event.type !== 'checkout.session.completed') {
    return NextResponse.json({ received: true, ignored: event.type });
  }

  const s = event.data?.object ?? {};
  const sessionId = String(s.id ?? '');
  const paymentStatus = String(s.payment_status ?? '');
  if (!sessionId || paymentStatus !== 'paid') {
    return NextResponse.json({ received: true, ignored: `payment_status=${paymentStatus}` });
  }

  if (await findOrderBySession(sessionId)) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  const metadata = (s.metadata ?? {}) as Record<string, string>;
  const slug = (metadata.slug ?? String(s.client_reference_id ?? '')).slice(0, 200);
  const title = (metadata.title ?? '').slice(0, 200);
  const email = String((s.customer_details as { email?: string } | undefined)?.email ?? '');
  const amountTotal = Number(s.amount_total ?? 0) / 100;
  const currency = String(s.currency ?? 'usd');

  const delivery = await sendCourseReceipt({ email, slug, title, amountTotal, currency });

  await appendOrder({
    ts: new Date().toISOString(),
    event_id: event.id ?? '',
    session_id: sessionId,
    email,
    slug,
    title,
    amount_total: amountTotal,
    currency,
    status: 'PAID',
    delivery: delivery.ok ? 'SENT' : 'PENDING',
    delivery_detail: delivery.detail ?? '',
  });

  return NextResponse.json({ received: true });
}
