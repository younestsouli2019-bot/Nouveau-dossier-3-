import { NextRequest, NextResponse } from 'next/server'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'

/**
 * POST /api/webhooks/rwc-payment
 * ------------------------------------------------------------------
 * The single production path that turns a confirmed rail payment into the
 * `rwc_sale_received` audit action that /api/realworldcerts/status counts.
 * Before this route existed that action was read but never produced by
 * anything in the repository, so a genuinely paid order was indistinguishable
 * from no order at all: the count stayed 0 forever.
 *
 * The body never claims payment. `paid` is not a field we accept, in any
 * shape. Payment is asserted by an HMAC signature over the exact bytes the
 * rail sent, and then confirmed against the price already on the order —
 * an unsigned body saying "paid: true" is worth nothing here.
 *
 * Fail-closed:
 *  - RWC_WEBHOOK_SECRET unset            -> 503 (sender retries later;
 *    we never fall back to processing unverified input).
 *  - signature absent/malformed/mismatch -> 400.
 *  - signature older than 5 minutes      -> 400 (replay window).
 *  - amount does not equal the order's price_amount_cents -> 409, and
 *    nothing is written: a short payment is not a sale.
 *
 * Signature: header `x-rwc-signature: t=<unix-seconds>,v1=<hex>` where
 * v1 = HMAC-SHA256(secret, `${t}.${rawBody}`). Same construction as the
 * Stripe receiver in this repo, so one mental model covers both.
 *
 * Idempotency: the audit row for the reference is the key, not the order
 * status. A retry after a partial failure still finishes the job; a retry
 * after success cannot double-count revenue.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.RWC_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'webhook_not_configured' }, { status: 503 })
  }

  const payload = await request.text()
  if (!verifySignature(request.headers.get('x-rwc-signature') ?? '', payload, secret)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 400 })
  }

  let body: any
  try {
    body = JSON.parse(payload)
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  // Minted as upper-case hex; normalise rather than reject a rail that
  // lower-cased it in transit.
  const reference = typeof body?.reference === 'string' ? body.reference.trim().toUpperCase() : ''
  if (!/^RWC-[0-9A-F]{10}-[0-9A-F]{10}-[0-9A-F]{10}-[0-9A-F]{10}$/.test(reference)) {
    return NextResponse.json({ error: 'invalid_reference' }, { status: 400 })
  }

  const amountMinor = body?.amountMinor
  if (typeof amountMinor !== 'number' || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    return NextResponse.json({ error: 'invalid_amount' }, { status: 400 })
  }

  // No txid means no proof to attach, and an unprovable "paid" is exactly
  // what this route exists to prevent.
  const providerTxid = typeof body?.providerTxid === 'string' ? body.providerTxid.trim() : ''
  if (!providerTxid || providerTxid.length > 200) {
    return NextResponse.json({ error: 'invalid_provider_txid' }, { status: 400 })
  }
  const provider = typeof body?.provider === 'string' ? body.provider.slice(0, 64) : 'unknown'

  const sale = await prisma.salesLedger.findFirst({ where: { order_reference: reference } })
  if (!sale) {
    // A quote lead has no price and therefore no payment to receive; it is
    // deliberately not payable through this endpoint.
    return NextResponse.json({ error: 'unknown_order' }, { status: 404 })
  }

  // The amount is the rail's claim checked against the price the owner
  // approved at order time. They must agree exactly, in minor units.
  if (amountMinor !== sale.price_amount_cents) {
    return NextResponse.json({ error: 'amount_mismatch' }, { status: 409 })
  }
  const currency = typeof body?.currency === 'string' ? body.currency.trim().toUpperCase() : ''
  if (currency && currency !== sale.currency.toUpperCase()) {
    return NextResponse.json({ error: 'currency_mismatch' }, { status: 409 })
  }

  const alreadyAudited = await prisma.auditLedger.count({
    where: { action: 'rwc_sale_received', entityId: reference },
  })
  if (alreadyAudited > 0 && sale.status === 'paid') {
    return NextResponse.json({ received: true, duplicate: true })
  }

  try {
    if (sale.status !== 'paid') {
      await prisma.salesLedger.update({
        where: { order_reference: reference },
        data: { status: 'paid', paidAt: new Date(), payment_provider_txid: providerTxid },
      })
    }

    if (alreadyAudited === 0) {
      await prisma.auditLedger.create({
        data: {
          entityType: 'rwc_sale',
          entityId: reference,
          action: 'rwc_sale_received',
          entryHash: createHash('sha256')
            .update(`rwc_sale_received:${reference}:${amountMinor}:${providerTxid}`)
            .digest('hex'),
          proofHash: providerTxid,
          performedBy: 'rwc-payment-webhook',
          metadata: JSON.stringify({
            reference,
            saleId: sale.id,
            slug: sale.product_slug,
            amountMinor,
            currency: sale.currency,
            provider,
            providerTxid,
          }),
        },
      })
    }
  } catch (e: any) {
    // payment_provider_txid is @unique: the same rail transaction being
    // claimed by a second order is a discrepancy, not a retry.
    if (e?.code === 'P2002') {
      return NextResponse.json({ error: 'duplicate_txid' }, { status: 409 })
    }
    // Anything else is retryable; the idempotency check above makes the
    // retry safe, so ask the sender to try again rather than half-succeed.
    return NextResponse.json({ error: 'audit_write_failed' }, { status: 503 })
  }

  return NextResponse.json({ received: true })
}

function verifySignature(header: string, payload: string, secret: string): boolean {
  try {
    const parts = Object.fromEntries(
      header.split(',').map((kv) => kv.split('=').map((x) => x.trim()) as [string, string]),
    )
    const t = parts.t ?? ''
    const v1 = parts.v1 ?? ''
    if (!t || !v1) return false

    const expected = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')
    const a = Buffer.from(v1, 'utf8')
    const b = Buffer.from(expected, 'utf8')
    if (!(a.length === b.length && a.length > 0 && timingSafeEqual(a, b))) return false

    const age = Math.abs(Date.now() / 1000 - Number(t))
    return Number.isFinite(age) && age <= 300
  } catch {
    return false
  }
}
