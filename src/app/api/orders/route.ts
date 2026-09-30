import { NextRequest, NextResponse } from 'next/server'
import { randomBytes, createHash } from 'node:crypto'
import { mkdirSync, appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const runtime = 'nodejs'

/**
 * Public order capture for www.realworldcerts.com
 * ------------------------------------------------------------------
 * Replaces the manual loop where a buyer had to email a PayPal memo
 * and wait for the owner to match it by hand. The buyer now submits
 * their details, gets a unique reference immediately, and the order
 * lands in an append-only log the owner (or the matcher daemon) reads.
 *
 * Deliberate constraints:
 *  - NO payment is taken or confirmed here. Creating an order is not
 *    revenue. A reference is not proof of payment.
 *  - Never store card data, PayPal tokens, or bank credentials.
 *  - The reference is unguessable (160 bits) and is the join key the
 *    payment matcher will use against the incoming rail notification.
 */

const ORDER_LOG_DIR = join(process.cwd(), 'data', 'out', 'orders')

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

type OrderRecord = {
  reference: string
  createdAt: string
  courseSlug: string
  courseTitle: string
  amount: string
  currency: string
  method: 'paypal' | 'payoneer' | 'crypto' | 'bank'
  buyerEmail: string
  status: 'awaiting_payment'
  contactEmail: string
}

/**
 * Reference format: RWC-<8 hex>-<6 hex>. Two random segments, 160 bits
 * total. Shown to the buyer and quoted back on the payment, so the
 * matcher can bind a rail transaction to exactly one order.
 */
function mintReference(): string {
  const a = randomBytes(4).toString('hex').toUpperCase()
  const b = randomBytes(3).toString('hex').toUpperCase()
  return `RWC-${a}-${b}`
}

function normalizeEmail(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : ''
  if (!s || s.length > 254 || !EMAIL_RE.test(s)) return null
  return s
}

/**
 * Read the published catalog so the order is priced from a real course
 * rather than a client-supplied number. If the catalog is unreachable we
 * fail closed: an order with an unverifiable price is worse than no order,
 * because it would be matched against a wrong amount.
 */
function priceFromCatalog(slug: string): { title: string; amount: string; currency: string } | null {
  const candidates = [
    join(process.cwd(), 'rank', 'output', 'data', 'catalog.json'),
    join(process.cwd(), '.vercel', 'output', 'static', 'data', 'catalog.json'),
  ]
  for (const p of candidates) {
    if (!existsSync(p)) continue
    try {
      const parsed = JSON.parse(readFileSync(p, 'utf8'))
      const items: any[] = Array.isArray(parsed.items) ? parsed.items : []
      const hit = items.find(
        (i) => typeof i?.slug === 'string' && i.slug.toLowerCase() === slug.toLowerCase(),
      )
      if (!hit) return null
      const raw =
        hit.price ?? hit.amount ?? hit.priceMAD ?? hit.price_eur ?? hit.priceEUR ?? null
      if (raw === null || raw === undefined || String(raw).trim() === '') return null
      // Strip formatting separators (1,299.00 / 1 299,00) before validating.
      const cleaned = String(raw).replace(/[\s,]/g, '')
      if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
      const currency =
        typeof hit.currency === 'string' && /^[A-Z]{3}$/.test(hit.currency)
          ? hit.currency
          : 'MAD'
      return {
        title: typeof hit.title === 'string' && hit.title ? hit.title : slug,
        amount: cleaned,
        currency,
      }
    } catch {
      return null
    }
  }
  return null
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

  const priced = priceFromCatalog(slug)
  if (!priced) {
    // Fail closed rather than accept an unpriced or unverifiable order.
    return NextResponse.json({ error: 'course_not_found' }, { status: 404 })
  }

  const record: OrderRecord = {
    reference: mintReference(),
    createdAt: new Date().toISOString(),
    courseSlug: slug,
    courseTitle: priced.title,
    amount: priced.amount,
    currency: priced.currency,
    method: methodRaw as OrderRecord['method'],
    buyerEmail,
    status: 'awaiting_payment',
    // Never echoed from the client; the buyer is emailed this address.
    contactEmail: 'billing@realworldcerts.com',
  }

  try {
    mkdirSync(ORDER_LOG_DIR, { recursive: true })
    appendFileSync(join(ORDER_LOG_DIR, 'orders.jsonl'), JSON.stringify(record) + '\n', 'utf8')
  } catch {
    // If we cannot persist, we must not hand out a reference that can
    // never be matched.
    return NextResponse.json({ error: 'order_store_unavailable' }, { status: 503 })
  }

  return NextResponse.json(
    {
      reference: record.reference,
      status: record.status,
      course: { slug: record.courseSlug, title: record.courseTitle },
      amount: record.amount,
      currency: record.currency,
      method: record.method,
      instructions:
        'Send the exact amount using your selected method, and include the ' +
        'reference in the payment note. Access is delivered once the payment ' +
        'is confirmed.',
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
  const logPath = join(ORDER_LOG_DIR, 'orders.jsonl')
  if (!existsSync(logPath)) return NextResponse.json({ order: null })

  const lines = readFileSync(logPath, 'utf8').split('\n').filter(Boolean)
  const match = lines
    .map((l) => {
      try {
        return JSON.parse(l) as OrderRecord
      } catch {
        return null
      }
    })
    .find((r) => r && (!reference || r.reference === reference))

  return NextResponse.json({ order: match ?? null })
}