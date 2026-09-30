import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function makeNextRequest(url: string, init?: RequestInit) {
	const req = new Request(url, init) as any
	req.cookies = { get: () => undefined }
	req.nextUrl = new URL(url)
	return req as import('next/server').NextRequest
}

describe('/api/orders — order capture', () => {
	let root: string
	const realCwd = process.cwd()

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'rwc-orders-'))
		// Capture the real function first; spying replaces the property, so
		// it cannot be invoked on the spied object.
		vi.spyOn(process, 'cwd').mockReturnValue(root)
		const dataDir = join(root, 'rank', 'output', 'data')
		mkdirSync(dataDir, { recursive: true })
		process.env.OPERATOR_TOKEN = 'test-operator-token'
	})

	afterEach(() => {
		vi.restoreAllMocks()
		vi.resetModules()
		void realCwd
		rmSync(root, { recursive: true, force: true })
		delete process.env.OPERATOR_TOKEN
	})

	function writeCatalog(items: unknown[]) {
		writeFileSync(
			join(root, 'rank', 'output', 'data', 'catalog.json'),
			JSON.stringify({ items }),
			'utf8',
		)
	}

	/**
	 * The price book is the only source of a price. `courses` maps catalog
	 * slug -> { mode, ... }. `approvedBy`/`approvedAt` are required: an entry
	 * without them is a half-finished edit and must be refused.
	 */
	function writePriceBook(courses: Record<string, unknown>, opts: Record<string, unknown> = {}) {
		const dir = join(root, 'rank', 'output', 'data', 'pricing')
		mkdirSync(dir, { recursive: true })
		writeFileSync(
			join(dir, 'prices.json'),
			JSON.stringify({
				schemaVersion: 1,
				updated: '2026-09-30',
				currency: 'MAD',
				minorUnits: 2,
				courses,
				...opts,
			}),
			'utf8',
		)
	}

	function fixed(amountMinor: number, extra: Record<string, unknown> = {}) {
		return {
			mode: 'fixed',
			amountMinor,
			approvedBy: 'owner',
			approvedAt: '2026-09-30',
			...extra,
		}
	}

	const QUOTE = { mode: 'quote_required', approvedBy: 'owner', approvedAt: '2026-09-30' }

	async function post(body: unknown) {
		const { POST } = await import('@/app/api/orders/route')
		return POST(makeNextRequest('https://www.realworldcerts.com/api/orders', {
			method: 'POST',
			body: JSON.stringify(body),
		}))
	}

	it('creates an order priced from the price book, ignoring any client amount', async () => {
		writeCatalog([{ slug: 'aws-saa', title: 'AWS SAA' }])
		writePriceBook({ 'aws-saa': fixed(129900) })
		const res = await post({
			email: 'Buyer@Example.com ',
			courseSlug: 'aws-saa',
			method: 'paypal',
			amount: '1.00',
			amountMinor: 1,
		})
		expect(res.status).toBe(201)
		const body = await res.json()
		expect(body.reference).toMatch(/^RWC-[0-9A-F]{10}-[0-9A-F]{10}-[0-9A-F]{10}-[0-9A-F]{10}$/)
		// 129900 minor units = 1299.00 MAD. The client sent 1.00 and lost.
		expect(body.amount).toBe('1299.00')
		expect(body.amountMinor).toBe(129900)
		expect(body.currency).toBe('MAD')
		expect(body.status).toBe('awaiting_payment')
		expect(body.course.title).toBe('AWS SAA')

		const log = readFileSync(join(root, 'data', 'out', 'orders', 'orders.jsonl'), 'utf8')
		const rec = JSON.parse(log.trim())
		expect(rec.buyerEmail).toBe('buyer@example.com')
		expect(rec.amountMinor).toBe(129900)
		// Buyer email is not echoed back to the browser response body.
		expect(JSON.stringify(body)).not.toContain('buyer@example.com')
	})

	it('mints a distinct reference per order', async () => {
		writeCatalog([{ slug: 'aws-saa', title: 'AWS SAA' }])
		writePriceBook({ 'aws-saa': fixed(9900) })
		const a = await (await post({ email: 'a@x.com', courseSlug: 'aws-saa', method: 'bank' })).json()
		const b = await (await post({ email: 'b@x.com', courseSlug: 'aws-saa', method: 'bank' })).json()
		expect(a.reference).not.toBe(b.reference)
	})

	describe('quote_required mode captures a lead with no amount', () => {
		it('records awaiting_quote and returns no amount at all', async () => {
			writeCatalog([{ slug: 'ccna-lab', title: 'CCNA Lab' }])
			writePriceBook({ 'ccna-lab': QUOTE })
			const res = await post({ email: 'q@x.com', courseSlug: 'ccna-lab', method: 'paypal' })
			expect(res.status).toBe(201)
			const body = await res.json()
			expect(body.status).toBe('awaiting_quote')
			// Explicitly null, never 0 and never a placeholder string.
			expect(body.amount).toBeNull()
			expect(body.amountMinor).toBeUndefined()
			expect(body.currency).toBe('MAD')

			const rec = JSON.parse(
				readFileSync(join(root, 'data', 'out', 'orders', 'orders.jsonl'), 'utf8').trim(),
			)
			expect(rec.amountMinor).toBeNull()
			expect(rec.quotedManually).toBe(true)
			expect(rec.courseTitle).toBe('CCNA Lab')
		})
	})

	describe('fail-closed on a broken price book', () => {
		it('mints nothing when the book is missing entirely', async () => {
			writeCatalog([{ slug: 'aws-saa', title: 'AWS SAA' }])
			const res = await post({ email: 'b@x.com', courseSlug: 'aws-saa', method: 'paypal' })
			expect(res.status).toBe(503)
			expect((await res.json()).error).toBe('price_book_unavailable')
			expect(existsSync(join(root, 'data', 'out', 'orders', 'orders.jsonl'))).toBe(false)
		})

		it('mints nothing for an unknown schema version', async () => {
			writeCatalog([{ slug: 'aws-saa', title: 'AWS SAA' }])
			writePriceBook({ 'aws-saa': fixed(100) }, { schemaVersion: 99 })
			expect((await post({ email: 'b@x.com', courseSlug: 'aws-saa', method: 'paypal' })).status).toBe(503)
		})

		it('mints nothing for a malformed amount (string, zero, negative, float)', async () => {
			writeCatalog([{ slug: 'aws-saa', title: 'AWS SAA' }])
			for (const bad of ['10.00', 0, -500, 12.5]) {
				vi.resetModules()
				writePriceBook({ 'aws-saa': fixed(bad as number) })
				const res = await post({ email: 'b@x.com', courseSlug: 'aws-saa', method: 'paypal' })
				expect(res.status, `amountMinor=${String(bad)}`).toBe(503)
				expect((await res.json()).reference).toBeUndefined()
			}
		})

		it('mints nothing when a fixed price lacks owner approval', async () => {
			writeCatalog([{ slug: 'aws-saa', title: 'AWS SAA' }])
			writePriceBook({
				'aws-saa': { mode: 'fixed', amountMinor: 5000 },
			})
			expect((await post({ email: 'b@x.com', courseSlug: 'aws-saa', method: 'paypal' })).status).toBe(503)
		})

		it('a catalog price field alone is never trusted', async () => {
			// The old implementation read price/amount/priceMAD off the
			// catalog item. That is the regression this guards: metadata is
			// not a price book, so a stray field cannot invent a charge.
			writeCatalog([{ slug: 'aws-saa', title: 'AWS SAA', price: '9999.00' }])
			const res = await post({ email: 'b@x.com', courseSlug: 'aws-saa', method: 'paypal' })
			expect(res.status).toBe(503)
			expect((await res.json()).error).toBe('price_book_unavailable')
		})
	})

	it('rejects a known catalog course that is not for sale', async () => {
		writeCatalog([{ slug: 'aws-saa', title: 'AWS SAA' }])
		writePriceBook({ 'other-course': fixed(100) })
		const res = await post({ email: 'b@x.com', courseSlug: 'aws-saa', method: 'paypal' })
		expect(res.status).toBe(404)
		expect((await res.json()).error).toBe('course_not_found')
	})

	it('rejects an unknown course', async () => {
		writeCatalog([{ slug: 'aws-saa', title: 'AWS SAA' }])
		writePriceBook({ 'aws-saa': fixed(1000) })
		const res = await post({ email: 'b@x.com', courseSlug: 'not-a-course', method: 'paypal' })
		expect(res.status).toBe(404)
	})

	it('rejects malformed email, bad method, and injection-y slugs', async () => {
		writeCatalog([{ slug: 'aws-saa', title: 'AWS SAA' }])
		writePriceBook({ 'aws-saa': fixed(1000) })
		expect((await post({ email: 'nope', courseSlug: 'aws-saa', method: 'paypal' })).status).toBe(400)
		expect((await post({ email: 'a@b.co', courseSlug: 'aws-saa', method: 'bitcoin' })).status).toBe(400)
		expect((await post({ email: 'a@b.co', courseSlug: '../../etc/passwd', method: 'paypal' })).status).toBe(400)
		expect((await post({ email: 'a@b.co', courseSlug: 'aws-saa/../x', method: 'paypal' })).status).toBe(400)
	})

	describe('admin lookup', () => {
		it('refuses GET without a valid operator token', async () => {
			writeCatalog([{ slug: 'aws-saa', title: 'AWS SAA' }])
			writePriceBook({ 'aws-saa': fixed(1000) })
			const { GET } = await import('@/app/api/orders/route')
			const anon = await GET(makeNextRequest('https://www.realworldcerts.com/api/orders'))
			expect(anon.status).toBe(401)
			const wrong = await GET(
				makeNextRequest('https://www.realworldcerts.com/api/orders', {
					headers: { authorization: 'Bearer nope' },
				}),
			)
			expect(wrong.status).toBe(401)
		})

		it('returns the order for a valid token', async () => {
			writeCatalog([{ slug: 'aws-saa', title: 'AWS SAA' }])
			writePriceBook({ 'aws-saa': fixed(5500) })
			const created = await (await post({ email: 'c@x.com', courseSlug: 'aws-saa', method: 'crypto' })).json()
			const { GET } = await import('@/app/api/orders/route')
			const res = await GET(
				makeNextRequest(`https://www.realworldcerts.com/api/orders?reference=${created.reference}`, {
					headers: { authorization: 'Bearer test-operator-token' },
				}),
			)
			expect(res.status).toBe(200)
			const body = await res.json()
			expect(body.order.reference).toBe(created.reference)
			expect(body.order.status).toBe('awaiting_payment')
		})
	})
})
