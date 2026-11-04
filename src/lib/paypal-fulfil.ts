/**
 * Idempotent fulfilment for a verified PayPal capture.
 * Records the order in the append-only ledger, then sends the receipt.
 * A retried webhook cannot double-deliver: the ledger row is the key.
 */
import { findCourse, priceFor } from '@/lib/rwc-catalog';
import { getOrder, verifyOrder } from '@/lib/paypal-checkout';
import { appendOrder, findOrderBySession } from '@/lib/rwc-order-ledger';
import { sendCourseReceipt } from '@/lib/rwc-delivery';

export interface FulfilResult {
  ok: boolean;
  reason?: string;
  slug?: string;
  title?: string;
}

export async function fulfilPayPalOrder(orderId: string): Promise<FulfilResult> {
  const existing = await findOrderBySession(orderId);
  if (existing && existing.delivery === 'SENT') {
    return { ok: true, reason: 'already_fulfilled', slug: existing.slug, title: existing.title };
  }

  const order = await getOrder(orderId);
  const unit = order?.purchase_units?.[0];
  const slug = String(unit?.reference_id ?? unit?.custom_id ?? '');
  const course = findCourse(slug);
  if (!course) return { ok: false, reason: `unknown_slug_${slug}` };

  const verdict = verifyOrder(order, { slug, amountUsd: priceFor(slug) });
  if (!verdict.ok) return { ok: false, reason: verdict.reason };

  const amount = Number(verdict.amount);
  const email = String(order?.payer?.email_address ?? existing?.email ?? '');
  const receipt = await sendCourseReceipt({
    email,
    slug,
    title: course.t,
    amountTotal: amount,
    currency: 'USD',
  });

  await appendOrder({
    ts: new Date().toISOString(),
    event_id: `paypal_${verdict.captureId}`,
    session_id: orderId,
    email,
    slug,
    title: course.t,
    amount_total: amount,
    currency: 'USD',
    status: 'PAID',
    delivery: receipt.ok ? 'SENT' : 'PENDING',
    delivery_detail: receipt.detail ?? '',
  });

  return { ok: true, slug, title: course.t };
}
