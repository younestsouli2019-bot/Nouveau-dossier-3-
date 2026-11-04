/**
 * PayPal Orders v2 — automated collection rail.
 *
 * Why this exists: the storefront routed "paypal" buyers to a static page with
 * manual instructions, so a payment was never machine-confirmed. This module
 * creates a real order, returns the approval URL, and verifies the capture
 * against the server-side catalog price before anything is delivered.
 *
 * Fail-closed rules:
 *  - Missing client id/secret -> isPayPalConfigured() false; callers fall back
 *    to the manual page instead of inventing a session.
 *  - Capture is verified server-side (status, currency, amount, slug). A
 *    browser redirect claiming success proves nothing.
 */
import { SITE_ORIGIN } from '@/lib/rwc-catalog';

export function apiBase(): string {
  const explicit = process.env.PAYPAL_API_BASE_URL?.replace(/\/+$/, '');
  if (explicit) return explicit;
  return process.env.PAYPAL_MODE === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

export function isPayPalConfigured(): boolean {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

type CachedToken = { value: string; expiresAt: number };
let cached: CachedToken | null = null;

/** Test seam only. */
export function __resetTokenCache(): void {
  cached = null;
}

export async function accessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.value;
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error('PAYPAL_NOT_CONFIGURED');

  const res = await fetch(`${apiBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`PAYPAL_AUTH_${res.status}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cached = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cached.value;
}

export interface CreateOrderInput {
  slug: string;
  title: string;
  amountUsd: number;
  email?: string;
}

export interface CreatedOrder {
  id: string;
  approveUrl: string;
}

export async function createOrder(input: CreateOrderInput): Promise<CreatedOrder> {
  const token = await accessToken();
  const body = {
    intent: 'CAPTURE',
    purchase_units: [
      {
        reference_id: input.slug.slice(0, 127),
        custom_id: input.slug.slice(0, 127),
        description: input.title.slice(0, 127),
        amount: { currency_code: 'USD', value: input.amountUsd.toFixed(2) },
      },
    ],
    application_context: {
      brand_name: 'RealWorldCerts',
      user_action: 'PAY_NOW',
      return_url: `${SITE_ORIGIN}/api/checkout/paypal/capture`,
      cancel_url: `${SITE_ORIGIN}/checkout/start.html`,
    },
  };

  const res = await fetch(`${apiBase()}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': `rwc-${input.slug}-${Date.now()}`.slice(0, 100),
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`PAYPAL_CREATE_${res.status}`);
  const json = (await res.json()) as { id: string; links?: Array<{ rel: string; href: string }> };
  const approve = json.links?.find((l) => l.rel === 'approve')?.href;
  if (!approve) throw new Error('PAYPAL_NO_APPROVE_LINK');
  return { id: json.id, approveUrl: approve };
}

export interface CaptureVerdict {
  ok: boolean;
  reason?: string;
  captureId?: string;
  amount?: string;
  currency?: string;
  slug?: string;
  email?: string;
}

/** Capture an approved order and verify it against the expected price/slug. */
export async function captureAndVerify(orderId: string, expected: { slug: string; amountUsd: number }): Promise<CaptureVerdict> {
  const token = await accessToken();
  const res = await fetch(`${apiBase()}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': `capture-${orderId}`,
    },
    body: '{}',
    cache: 'no-store',
  });
  // An already-captured order returns 422; fall back to reading it.
  const json: any = res.ok ? await res.json() : await getOrder(orderId, token);
  return verifyOrder(json, expected);
}

export async function getOrder(orderId: string, tokenOverride?: string): Promise<any> {
  const token = tokenOverride ?? (await accessToken());
  const res = await fetch(`${apiBase()}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`PAYPAL_GET_${res.status}`);
  return res.json();
}

export function verifyOrder(order: any, expected: { slug: string; amountUsd: number }): CaptureVerdict {
  if (!order || order.status !== 'COMPLETED') {
    return { ok: false, reason: `order_status_${order?.status ?? 'missing'}` };
  }
  const unit = order.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  if (!capture || capture.status !== 'COMPLETED') {
    return { ok: false, reason: `capture_status_${capture?.status ?? 'missing'}` };
  }
  const amount = String(capture.amount?.value ?? '');
  const currency = String(capture.amount?.currency_code ?? '');
  const slug = String(unit?.reference_id ?? unit?.custom_id ?? '');

  if (currency !== 'USD') return { ok: false, reason: `currency_${currency}` };
  if (Number(amount) !== Number(expected.amountUsd.toFixed(2))) {
    return { ok: false, reason: `amount_${amount}_expected_${expected.amountUsd.toFixed(2)}` };
  }
  if (expected.slug && slug !== expected.slug) {
    return { ok: false, reason: `slug_${slug}_expected_${expected.slug}` };
  }
  return { ok: true, captureId: capture.id, amount, currency, slug };
}
