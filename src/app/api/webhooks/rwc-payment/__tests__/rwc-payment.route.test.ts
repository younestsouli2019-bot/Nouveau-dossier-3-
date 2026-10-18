import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { createHmac } from 'node:crypto'

/**
 * The route persists through Prisma, and src/lib/db.ts builds its client at
 * import time. Mocking the module keeps the suite offline and lets us assert
 * exactly what was written — which, for a payment receiver, is the whole
 * point: no audit row and no status flip unless the money checked out.
 *
 * The crypto is NOT mocked. Every signature below is a real HMAC, so the
 * verification path is genuinely exercised.
 */
const db = vi.hoisted(() => ({ sales: [] as any[], audit: [] as any[] }))

vi.mock('@/lib/db', () => ({
	prisma: {
		salesLedger: {
			findFirst: vi.fn(
				async ({ where }: any) =>
					db.sales.find((r) => r.order_reference === where?.order_reference) ?? null,
			),
			update: vi.fn(async ({ where, data }: any) => {
				const row = db.sales.find((r) => r.order_reference === where?.order_reference)
				if (!row) throw new Error('record not found')
				// Emulate the @unique on payment_provider_txid.
				if (
					data.payment_provider_txid &&
					db.sales.some(
						(r) => r !== row && r.payment_provider_txid === data.payment_provider_txid,
					)
				) {
					const err: any = new Error('Unique constraint failed')
					err.code = 'P2002'
					throw err
				}
				Object.assign(row, data)
				return row
			}),
		},
		auditLedger: {
			count: vi.fn(
				async ({ where }: any) =>
					db.audit.filter(
						(a) => a.action === where?.action && a.entityId === where?.entityId,
					).length,
			),
			create: vi.fn(async ({ data }: any) => {
				const row = { id: `al_${db.audit.length + 1}`, createdAt: new Date(), ...data }
				db.audit.push(row)
				return row
			}),
		},
	},
}))

const SECRET = 'test-rwc-webhook-secret'
const REF = `RWC-${'A'.repeat(10)}-${'B'.repeat(10)}-${'C'.repeat(10)}-${'D'.repeat(10)}`
const TXID = 'PAYPAL-8QZ1K2M3N4'

const sign = (
	payload: string,
	t: number = Math.floor(Date.now() / 1000),
	secret: string = SECRET,
) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')}`

describe('/api/webhooks/rwc-payment — rail payment receiver', () => {
	beforeEach(() => {
		db.sales.length = 0
		db.audit.length = 0
		process.env.RWC_WEBHOOK_SECRET = SECRET
	})

	afterEach(() => {
		vi.resetModules()
		delete process.env.RWC_WEBHOOK_SECRET
	})

	function seedSale(over: Record<string, unknown> = {}) {
		const row = {
			id: 'sl_1',
			order_reference: REF,
			product_slug: 'aws-saa',
			price_amount_cents: 129900,
			currency: 'MAD',
			payment_method: 'paypal',
			status: 'awaiting_payment',
			buyer_email_hash: 'f'.repeat(64),
			...over,
		}
		db.sales.push(row)
		return row
	}

	/** header === null omits the header entirely; undefined signs the body. */
	async function post(body: unknown, header?: string | null) {
		const { POST } = await import('@/app/api/webhooks/rwc-payment/route')
		const payload = JSON.stringify(body)
		const sig = header === undefined ? sign(payload) : header
		const req = new Request('https://www.realworldcerts.com/api/webhooks/rwc-payment', {
			method: 'POST',
			body: payload,
			headers: sig ? { 'x-rwc-signature': sig } : {},
		})
		return POST(req as any)
	}

	const paid = (over: Record<string, unknown> = {}) => ({
		reference: REF,
		amountMinor: 129900,
		currency: 'MAD',
		provider: 'paypal',
		providerTxid: TXID,
		...over,
	})

	it('fails closed when the signing secret is not configured', async () => {
		delete process.env.RWC_WEBHOOK_SECRET
		seedSale()
		const res = await post(paid())
		expect(res.status).toBe(503)
		expect((await res.json()).error).toBe('webhook_not_configured')
		expect(db.audit).toHaveLength(0)
	})

	it('rejects an absent or wrong signature and writes nothing', async () => {
		seedSale()
		expect((await post(paid(), null)).status).toBe(400)
		const wrong = sign(JSON.stringify(paid()), undefined, 'not-the-secret')
		expect((await post(paid(), wrong)).status).toBe(400)
		expect(db.audit).toHaveLength(0)
		expect(db.sales[0].status).toBe('awaiting_payment')
	})

	it('rejects a replayed signature older than the 5 minute window', async () => {
		seedSale()
		const stale = Math.floor(Date.now() / 1000) - 600
		const res = await post(paid(), sign(JSON.stringify(paid()), stale))
		expect(res.status).toBe(400)
		expect(db.audit).toHaveLength(0)
	})

	it('never treats an unsigned body claiming payment as payment', async () => {
		seedSale()
		// The exact shape the pasted patch set would have trusted.
		const res = await post({ reference: REF, paid: true, amountMinor: 129900 }, null)
		expect(res.status).toBe(400)
		expect(res.status).not.toBe(200)
		expect(db.audit).toHaveLength(0)
		expect(db.sales[0].status).toBe('awaiting_payment')
	})

	it('rejects a reference that is not a sales order', async () => {
		const res = await post(paid({ reference: 'RWC-0000000000-0000000000-0000000000-0000000000' }))
		expect(res.status).toBe(404)
		expect((await res.json()).error).toBe('unknown_order')
	})

	it('rejects a short payment without touching the order', async () => {
		seedSale()
		const res = await post(paid({ amountMinor: 1 }))
		expect(res.status).toBe(409)
		expect((await res.json()).error).toBe('amount_mismatch')
		// A partial payment is not a sale.
		expect(db.audit).toHaveLength(0)
		expect(db.sales[0].status).toBe('awaiting_payment')
	})

	it('marks the order paid and writes exactly one rwc_sale_received', async () => {
		seedSale()
		const res = await post(paid())
		expect(res.status).toBe(200)

		const sale = db.sales[0]
		expect(sale.status).toBe('paid')
		expect(sale.payment_provider_txid).toBe(TXID)
		expect(sale.paidAt).toBeInstanceOf(Date)

		// This is the action /api/realworldcerts/status counts.
		expect(db.audit).toHaveLength(1)
		const row = db.audit[0]
		expect(row.action).toBe('rwc_sale_received')
		expect(row.entityId).toBe(REF)
		expect(row.entityType).toBe('rwc_sale')
		expect(row.proofHash).toBe(TXID)
		expect(row.performedBy).toBe('rwc-payment-webhook')
		expect(row.entryHash).toHaveLength(64)
		const meta = JSON.parse(row.metadata)
		expect(meta.reference).toBe(REF)
		expect(meta.amountMinor).toBe(129900)
		expect(meta.slug).toBe('aws-saa')
	})

	it('is idempotent: a replay does not double-count revenue', async () => {
		seedSale()
		expect((await post(paid())).status).toBe(200)
		const second = await post(paid())
		expect(second.status).toBe(200)
		expect((await second.json()).duplicate).toBe(true)
		// Still one sale, still one audit row.
		expect(db.audit).toHaveLength(1)
	})

	it('refuses a rail transaction already claimed by another order', async () => {
		seedSale({ id: 'sl_first' })
		seedSale({ id: 'sl_second', order_reference: `RWC-${'1'.repeat(10)}-${'2'.repeat(10)}-${'3'.repeat(10)}-${'4'.repeat(10)}` })
		expect((await post(paid())).status).toBe(200)

		const again = await post(
			paid({
				reference: `RWC-${'1'.repeat(10)}-${'2'.repeat(10)}-${'3'.repeat(10)}-${'4'.repeat(10)}`,
			}),
		)
		expect(again.status).toBe(409)
		expect((await again.json()).error).toBe('duplicate_txid')
		expect(db.audit).toHaveLength(1)
	})
})
