import { NextRequest, NextResponse } from 'next/server';
import { findCourse, priceFor, SITE_ORIGIN } from '@/lib/rwc-catalog';

/**
 * POST /api/checkout/create
 *
 * One entry point for every method rendered on /checkout/start.html:
 *  - method "card"  → Stripe Checkout Session (redirect to session.url)
 *  - method "cmi"   → fail-closed 503 until Attijari SimplePay creds exist
 *  - paypal / payoneer / crypto / bank → redirect to the existing static
 *    instruction pages (manual order-reference flow)
 *
 * Fail-closed rules:
 *  - No STRIPE_SECRET_KEY → 503 with a clear, buyer-friendly setup message.
 *  - Unknown course slug → 400.
 *  - Price always resolved server-side; the client cannot set amounts.
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request body.' }, { status: 400 });
  }

  const method = String(body.method ?? 'card').toLowerCase();
  const slug = typeof body.slug === 'string' ? body.slug.slice(0, 200) : '';
  const courseTitle = typeof body.course === 'string' ? body.course.slice(0, 200) : '';
  const email = typeof body.email === 'string' ? body.email.trim().slice(0, 200) : '';
  const productId = typeof body.product_id === 'string' ? body.product_id.slice(0, 100) : '';

  const course = findCourse(slug);
  if (!course && !courseTitle) {
    return NextResponse.json(
      { success: false, error: 'We could not identify this course. Please reopen it from the catalog and try again.' },
      { status: 400 },
    );
  }
  const title = course?.t ?? courseTitle;
  const effectiveSlug = course?.s ?? slug;

  // Manual methods: keep the existing static instruction pages as the flow.
  const manual: Record<string, string> = {
    paypal: '/checkout/paypal.html',
    payoneer: '/checkout/payoneer.html',
    crypto: '/checkout/crypto.html',
    bank: '/checkout/bank.html',
  };
  if (manual[method]) {
    const qs = new URLSearchParams({ course: title, slug: effectiveSlug });
    if (email) qs.set('email', email);
    if (productId) qs.set('ref', productId);
    return NextResponse.json({ success: true, url: `${SITE_ORIGIN}${manual[method]}?${qs.toString()}` });
  }

  if (method === 'cmi') {
    return NextResponse.json(
      {
        success: false,
        error: 'Card payments in MAD are not enabled yet.',
        setup: 'Use PayPal or USDT, or email billing@realworldcerts.com for a payment request.',
      },
      { status: 503 },
    );
  }

  // Default and "card": Stripe Checkout.
  if (method !== 'card' && method !== 'stripe') {
    return NextResponse.json({ success: false, error: `Unsupported payment method: ${method}` }, { status: 400 });
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    return NextResponse.json(
      {
        success: false,
        error: 'Card payments are being enabled right now — please use PayPal or USDT meanwhile.',
        setup: 'Card checkout will go live as soon as the Stripe key is configured (STRIPE_SECRET_KEY).',
      },
      { status: 503 },
    );
  }

  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  const unitAmount = Math.round(priceFor(effectiveSlug) * 100);

  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('success_url', `${SITE_ORIGIN}/checkout/thanks.html?session_id={CHECKOUT_SESSION_ID}`);
  params.set('cancel_url', `${SITE_ORIGIN}/checkout/start.html`);
  params.set('client_reference_id', effectiveSlug);
  params.set('metadata[slug]', effectiveSlug);
  params.set('metadata[title]', title);
  if (emailOk) params.set('customer_email', email);
  params.set('line_items[0][quantity]', '1');
  params.set('line_items[0][price_data][currency]', 'usd');
  params.set('line_items[0][price_data][unit_amount]', String(unitAmount));
  params.set('line_items[0][price_data][product_data][name]', `Course: ${title}`);
  params.set('line_items[0][price_data][product_data][description]', 'Full practice-test bank with explanations, lifetime access, email support. Instant delivery by email.');

  let res: Response;
  try {
    res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Stripe-Version': '2025-08-27.basil',
      },
      body: params.toString(),
    });
  } catch {
    return NextResponse.json(
      { success: false, error: 'We could not reach the payment provider. Please try again in a minute.' },
      { status: 502 },
    );
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || !data.url) {
    console.error('[checkout/create] Stripe error', res.status, JSON.stringify(data).slice(0, 500));
    return NextResponse.json(
      { success: false, error: 'Payment could not be started right now. Please try again or email billing@realworldcerts.com.' },
      { status: 502 },
    );
  }

  return NextResponse.json({ success: true, url: data.url });
}
