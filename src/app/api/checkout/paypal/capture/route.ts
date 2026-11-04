import { NextRequest, NextResponse } from 'next/server';
import { findCourse, priceFor, SITE_ORIGIN } from '@/lib/rwc-catalog';
import { captureAndVerify, getOrder } from '@/lib/paypal-checkout';
import { fulfilPayPalOrder } from '@/lib/paypal-fulfil';

export const runtime = 'nodejs';

/**
 * GET /api/checkout/paypal/capture?token=<orderId>&PayerID=...
 * PayPal redirects here after approval. The browser's word is not evidence:
 * the order is captured and verified server-side before fulfilment.
 */
export async function GET(request: NextRequest) {
  const orderId = request.nextUrl.searchParams.get('token') ?? '';
  const thanks = `${SITE_ORIGIN}/checkout/thanks.html`;
  if (!orderId) return NextResponse.redirect(`${thanks}?status=error&reason=missing_token`);

  try {
    const order = await getOrder(orderId);
    const unit = order?.purchase_units?.[0];
    const slug = String(unit?.reference_id ?? unit?.custom_id ?? '');
    const course = findCourse(slug);
    if (!course) return NextResponse.redirect(`${thanks}?status=error&reason=unknown_course`);

    const verdict = await captureAndVerify(orderId, { slug, amountUsd: priceFor(slug) });
    if (!verdict.ok) {
      return NextResponse.redirect(`${thanks}?status=error&reason=${encodeURIComponent(verdict.reason ?? 'capture_failed')}`);
    }

    const fulfilled = await fulfilPayPalOrder(orderId);
    if (!fulfilled.ok) {
      return NextResponse.redirect(`${thanks}?status=error&reason=${encodeURIComponent(fulfilled.reason ?? 'fulfil_failed')}`);
    }
    return NextResponse.redirect(`${thanks}?status=ok&provider=paypal&session_id=${encodeURIComponent(orderId)}`);
  } catch (err) {
    console.error('[paypal-capture]', (err as Error)?.message);
    return NextResponse.redirect(`${thanks}?status=error&reason=capture_exception`);
  }
}
