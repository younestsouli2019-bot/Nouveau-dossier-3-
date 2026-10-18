import { NextRequest, NextResponse } from 'next/server'
import { randomBytes, createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'

/**
 * Public order capture for www.realworldcerts.com
 * ------------------------------------------------------------------
 * Replaces the manual loop where a buyer had to email a PayPal memo
 * and wait for the owner to match it by hand. The buyer now submits
 * their details, gets a unique reference immediately, and the order
 * is persisted so the owner (or the matcher daemon) can find it.
 *
 * Deliberate constraints:
 *  - NO payment is taken or confirmed here. Creating an order is not
 *    revenue. A reference is not proof of payment.
 *  - Never store card data, PayPal tokens, or bank credentials.
 *  - The reference is unguessable (160 bits) and is the join key the
 *    payment matcher will use against the incoming rail notification.
 *  - The buyer's address is persisted as a SHA-256 hash only, matching
 *    SalesLedger.buyer_email_hash ("NO PII PLAIN").
 *
 * Persistence is split by order type, because the two are not the same
 * thing and the schema says so:
 *   - a priced order (awaiting_payment) is a receivable -> SalesLedger,
 *     whose price_amount_cents is a required positive integer;
 *   - a quote request (awaiting_quote) has no amount at all and is a
 *     lead, not a receivable -> InboundLead.
 * Storing a lead in SalesLedger would require inventing a price, which
 * is exactly the fabrication the pricing contract forbids.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/**
 * An order is either priced or a quote lead.
 *
 * `awaiting_payment` orders carry an amount and can be matched against an
 * incoming rail notification. `awaiting_quote` orders carry NO amount: the
 * course is sellable but priced per deal, so a human quotes it out of band.
 * A quote lead can never be auto-matched against a payment by mistake,
 * because there is no amount to match on.
 */
type OrderRecord = {
  reference: string
  createdAt: string
  courseSlug: string
  courseTitle: string
  /** Integer minor units (MAD cents). Present only when status is awaiting_payment. */
  amountMinor: number | null
  currency: string
  method: 'paypal' | 'payoneer' | 'crypto' | 'bank'
  buyerEmail: string
  status: 'awaiting_payment' | 'awaiting_quote'
  contactEmail: string
  /** Set when the amount came from a `quote_required` price-book entry. */
  quotedManually?: boolean
}

/**
 * Reference format: RWC-<10 hex>-<10 hex>-<10 hex>-<10 hex>, i.e. four
 * 5-byte groups rendered as 40 hex characters. 20 bytes * 8 bits = 160 bits
 * of CSPRNG entropy. The dashes are purely for legibility: an operator
 * reads these back over the phone to bind a rail transaction to exactly one
 * order, so the groups are uniform width rather than one unbroken blob.
 */
function mintReference(): string {
  const hex = randomBytes(20).toString('hex').toUpperCase()
  return `RWC-${hex.match(/.{1,10}/g)!.join('-')}`
}

function normalizeEmail(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : ''
  if (!s || s.length > 254 || !EMAIL_RE.test(s)) return null
  return s
}

type CatalogEntry = { title: string } | null
type PriceBookEntry =
  | { kind: 'fixed'; amountMinor: number; currency: string }
  | { kind: 'quote_required'; currency: string }

/** Distinguishes "no such course" from "price source is broken". */
type PriceLookup =
  | { state: 'priced'; title: string; amountMinor: number; currency: string }
  | { state: 'quote'; title: string; currency: string }
  | { state: 'not_for_sale' }
  | { state: 'source_unavailable' }

function readJson(p: string): any | undefined {
  if (!existsSync(p)) return undefined
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return undefined
  }
}

function findCatalogEntry(slug: string): CatalogEntry {
  for (const p of [
    join(process.cwd(), 'rank', 'output', 'data', 'catalog.json'),
    join(process.cwd(), '.vercel', 'output', 'static', 'data', 'catalog.json'),
  ]) {
    const parsed = readJson(p)
    if (!parsed) continue
    const items: any[] = Array.isArray(parsed.items) ? parsed.items : []
    const hit = items.find(
      (i) => typeof i?.slug === 'string' && i.slug.toLowerCase() === slug.toLowerCase(),
    )
    if (!hit) return null
    return { title: typeof hit.title === 'string' && hit.title ? hit.title : slug }
  }
  return null
}

/**
 * Resolve a course slug to a price using ONLY the owner's price book.
 *
 * The book is a separate file from the catalog on purpose: prices are
 * commercial decisions that change on their own schedule, and the catalog
 * is republished often. It also carries an explicit `quote_required` mode,
 * which is how this business actually sells today ("Confirmed via email").
 * That lets a lead be captured without inventing a number.
 *
 * Fail-closed: an unreadable book, an unknown schema version, or a `fixed`
 * entry whose amount is not a positive integer of minor units yields
 * `source_unavailable`, and the caller mints no reference. An order that
 * exists but cannot be priced correctly is worse than no order.
 */
function resolvePrice(slug: string): PriceLookup {
  let book: any
  let sawBook = false
  for (const p of [
    join(process.cwd(), 'rank', 'output', 'data', 'pricing', 'prices.json'),
    join(process.cwd(), '.vercel', 'output', 'static', 'data', 'pricing', 'prices.json'),
  ]) {
    const parsed = readJson(p)
    if (parsed) {
      book = parsed
      sawBook = true
      break
    }
  }
  if (!sawBook) return { state: 'source_unavailable' }
  if (book?.schemaVersion !== 1) return { state: 'source_unavailable' }

  const currency =
    typeof book.currency === 'string' && /^[A-Z]{3}$/.test(book.currency) ? book.currency : null
  if (!currency) return { state: 'source_unavailable' }

  const courses = book.courses && typeof book.courses === 'object' ? book.courses : {}
  const key = Object.keys(courses).find((k) => k.toLowerCase() === slug.toLowerCase())
  if (!key) return { state: 'not_for_sale' }

  const raw = courses[key]
  // A price without owner approval metadata is a half-finished edit, not a
  // price. Refuse it rather than guessing who authorised it.
  if (!raw || typeof raw !== 'object') return { state: 'source_unavailable' }
  if (typeof raw.approvedBy !== 'string' || !raw.approvedBy.trim()) {
    return { state: 'source_unavailable' }
  }
  if (typeof raw.approvedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.approvedAt)) {
    return { state: 'source_unavailable' }
  }

  const title = findCatalogEntry(slug)?.title ?? slug

  if (raw.mode === 'quote_required') {
    return { state: 'quote', title, currency }
  }
  if (raw.mode !== 'fixed') return { state: 'source_unavailable' }

  const amount = raw.amountMinor
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) {
    return { state: 'source_unavailable' }
  }
  return { state: 'priced', title, amountMinor: amount, currency }
}

/** Render minor units as a display string without going through a float. */
function formatMinor(amountMinor: number, minorUnits: number): string {
  if (minorUnits === 0) return String(amountMinor)
  const div = 10 ** minorUnits
  const whole = Math.trunc(amountMinor / div)
  const frac = String(amountMinor % div).padStart(minorUnits, '0')
  return `${whole}.${frac}`
}

/**
 * Declared once by the price book. Cached per process because it is part of
 * the book's own contract: changing it changes the meaning of every existing
 * amountMinor, so it is read as a constant rather than inferred per request.
 */
function readMinorUnits(): number {
  for (const p of [
    join(process.cwd(), 'rank', 'output', 'data', 'pricing', 'prices.json'),
    join(process.cwd(), '.vercel', 'output', 'static', 'data', 'pricing', 'prices.json'),
  ]) {
    const parsed = readJson(p)
    if (parsed) {
      return typeof parsed.minorUnits === 'number' &&
        Number.isSafeInteger(parsed.minorUnits) &&
        parsed.minorUnits >= 0 &&
        parsed.minorUnits <= 4
        ? parsed.minorUnits
        : 2
    }
  }
  return 2
}

let PRICE_BOOK_MINOR_UNITS: number | undefined
function minorUnits(): number {
  if (PRICE_BOOK_MINOR_UNITS === undefined) PRICE_BOOK_MINOR_UNITS = readMinorUnits()
  return PRICE_BOOK_MINOR_UNITS
}

export async function POST(request: NextRequest) {
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const buyerEmail = normalizeEmail(body?.email)
  if (!buyerEmail) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 })
  }

  const slug = typeof body?.courseSlug === 'string' ? body.courseSlug.trim() : ''
  if (!slug || slug.length > 200 || !/^[a-z0-9][a-z0-9-]*$/i.test(slug)) {
    return NextResponse.json({ error: 'invalid_course' }, { status: 400 })
  }

  const methodRaw = typeof body?.method === 'string' ? body.method.toLowerCase() : ''
  if (!['paypal', 'payoneer', 'crypto', 'bank'].includes(methodRaw)) {
    return NextResponse.json({ error: 'invalid_method' }, { status: 400 })
  }

  const price = resolvePrice(slug)
  if (price.state === 'not_for_sale') {
    return NextResponse.json({ error: 'course_not_found' }, { status: 404 })
  }
  if (price.state === 'source_unavailable') {
    // The book exists but we cannot trust it. Minting nothing is the whole
    // point: an order whose amount we cannot prove is not reconcilable.
    return NextResponse.json({ error: 'price_book_unavailable' }, { status: 503 })
  }

  const isQuote = price.state === 'quote'
  const record: OrderRecord = {
    reference: mintReference(),
    createdAt: new Date().toISOString(),
    courseSlug: slug,
    courseTitle: price.title,
    // A quote lead carries no amount at all. Never 0, never a placeholder:
    // an explicit null is what makes "not yet priced" distinguishable from
    // "priced at zero".
    amountMinor: isQuote ? null : price.amountMinor,
    currency: price.currency,
    method: methodRaw as OrderRecord['method'],
    buyerEmail,
    status: isQuote ? 'awaiting_quote' : 'awaiting_payment',
    quotedManually: isQuote,
    // Never echoed from the client; the buyer is emailed this address.
    contactEmail: 'billing@realworldcerts.com',
  }

  // The buyer's address is never stored in the clear, matching the schema
  // comment on SalesLedger.buyer_email_hash ("NO PII PLAIN"). The hash is
  // enough to recognise a returning buyer and to reconcile against a rail
  // notification; it is not enough to re-contact anyone from a dump.
  const buyerEmailHash = createHash('sha256').update(buyerEmail).digest('hex')

  try {
    if (isQuote) {
      // A lead, not a receivable. There is no amount here on purpose: the
      // only honest value would be invented, and an invented price is
      // exactly what the price-book contract exists to prevent.
      await prisma.inboundLead.create({
        data: {
          campaign: 'realworldcerts_checkout',
          source: 'checkout_quote_request',
          product_slug: record.courseSlug,
          metadata: {
            // The reference is returned to the buyer, so the row has to
            // carry it or the reference resolves to nothing later.
            reference: record.reference,
            courseTitle: record.courseTitle,
            currency: record.currency,
            method: record.method,
            buyerEmailHash,
            status: record.status,
          },
        },
      })
    } else {
      // A receivable. price_amount_cents is a positive integer under CHECK
      // salesledger_amount_positive, which resolvePrice has already
      // guaranteed; a lead could not be written here even if we tried.
      await prisma.salesLedger.create({
        data: {
          order_reference: record.reference,
          product_slug: record.courseSlug,
          buyer_email_hash: buyerEmailHash,
          price_amount_cents: price.amountMinor,
          currency: record.currency,
          payment_method: record.method,
          status: 'awaiting_payment',
        },
      })
    }
  } catch {
    // If we cannot persist, we must not hand out a reference that can
    // never be matched.
    return NextResponse.json({ error: 'order_store_unavailable' }, { status: 503 })
  }

  const mu = minorUnits()

  return NextResponse.json(
    {
      reference: record.reference,
      status: record.status,
      course: { slug: record.courseSlug, title: record.courseTitle },
      currency: record.currency,
      method: record.method,
      ...(isQuote
        ? {
            // No amount is returned. A buyer is told a human will quote, and
            // nothing on the wire implies a price exists yet.
            amount: null,
            instructions:
              'We have your request. This course is priced per order, so a ' +
              'quote will be emailed to you with payment instructions. No ' +
              'payment is required yet. Keep your reference ' +
              `${record.reference} for any correspondence.`,
          }
        : {
            amountMinor: record.amountMinor,
            amount: formatMinor(record.amountMinor as number, mu),
            instructions:
              'Send the exact amount using your selected method, and include ' +
              'the reference in the payment note. Access is delivered once the ' +
              'payment is confirmed.',
          }),
    },
    { status: 201 },
  )
}

/**
 * Admin lookup by reference. Protected by the shared OPERATOR_TOKEN that
 * middleware already uses for protected POST paths, and read-only.
 */
export async function GET(request: NextRequest) {
  const token = process.env.OPERATOR_TOKEN
  if (!token) return NextResponse.json({ error: 'unavailable' }, { status: 503 })
  const provided =
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    request.cookies.get('operator_session')?.value
  if (!provided) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const expected = createHash('sha256').update(token).digest()
  const got = createHash('sha256').update(provided).digest()
  if (!expected.equals(got)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const reference = request.nextUrl.searchParams.get('reference')
  if (!reference) return NextResponse.json({ error: 'reference_required' }, { status: 400 })

  // Two tables, one reference. Look in both, because a reference is minted
  // before we know whether the course is priced or quoted, and the buyer is
  // told the same reference either way.
  try {
    const sale = await prisma.salesLedger.findFirst({ where: { order_reference: reference } })
    if (sale) {
      return NextResponse.json({
        order: {
          reference: sale.order_reference,
          status: sale.status,
          courseSlug: sale.product_slug,
          // SalesLedger stores the slug, not the published title.
          courseTitle: findCatalogEntry(sale.product_slug)?.title ?? sale.product_slug,
          amountMinor: sale.price_amount_cents,
          currency: sale.currency,
          method: sale.payment_method,
          buyerEmailHash: sale.buyer_email_hash,
          createdAt: sale.createdAt,
          source: 'sales_ledger',
        },
      })
    }

    const lead = await prisma.inboundLead.findFirst({
      where: { metadata: { path: ['reference'], equals: reference } },
    })
    if (!lead) return NextResponse.json({ order: null })

    const meta = (lead.metadata ?? {}) as Record<string, unknown>
    const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
    return NextResponse.json({
      order: {
        reference,
        status: str(meta.status) ?? 'awaiting_quote',
        courseSlug: lead.product_slug,
        courseTitle: str(meta.courseTitle),
        // A lead is never given an amount, here or anywhere else.
        amountMinor: null,
        currency: str(meta.currency),
        method: str(meta.method),
        buyerEmailHash: str(meta.buyerEmailHash),
        createdAt: lead.createdAt,
        source: 'inbound_lead',
      },
    })
  } catch {
    return NextResponse.json({ error: 'order_store_unavailable' }, { status: 503 })
  }
}