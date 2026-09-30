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

	async function post(body: unknown) {
		const { POST } = await import('@/app/api/orders/route')
		return POST(makeNextRequest('https://www.realworldcerts.com/api/orders', {
			method: 'POST',
			body: JSON.stringify(body),
		}))
	}

	it('creates an order with a unique reference priced from the catalog', async () => {
		writeCatalog([{ slug: 'aws-saa', title: 'AWS SAA', price: '1,299.00', currency: 'MAD' }])
		const res = await post({
			email: 'Buyer@Example.com ',
			courseSlug: 'aws-saa',
			method: 'paypal',
		})
		expect(res.status).toBe(201)
		const body = await res.json()
		expect(body.reference).toMatch(/^RWC-[0-9A-F]{8}-[0-9A-F]{6}$/)
		// Comma-formatted price is normalized, and the client cannot set it.
		expect(body.amount).toBe('1299.00')
		expect(body.currency).toBe('MAD')
		expect(body.status).toBe('awaiting_payment')
		expect(body.course.title).toBe('AWS SAA')

		const log = readFileSync(join(root, 'data', 'out', 'orders', 'orders.jsonl'), 'utf8')
		const rec = JSON.parse(log.trim())
		expect(rec.buyerEmail).toBe('buyer@example.com')
		// Buyer email is not echoed back to the browser response body.
		expect(JSON.stringify(body)).not.toContain('buyer@example.com')
	})

	it('mints a distinct reference per order', async () => {
		writeCatalog([{ slug: 'aws-saa', title: 'AWS SAA', price: '99.00' }])
		const a = await (await post({ email: 'a@x.com', courseSlug: 'aws-saa', method: 'bank' })).json()
		const b = await (await post({ email: 'b@x.com', courseSlug: 'aws-saa', method: 'bank' })).json()
		expect(a.reference).not.toBe(b.reference)
	})

	it('fails closed when the catalog has no price — never trusts a client amount', async () => {
		writeCatalog([{ slug: 'aws-saa', title: 'AWS SAA' }])
		const res = await post({
			email: 'b@x.com',
			courseSlug: 'aws-saa',
			method: 'paypal',
			amount: '1.00',
		})
		expect(res.status).toBe(404)
		const body = await res.json()
		expect(body.error).toBe('course_not_found')
		// No reference may be issued for an unverifiable amount.
		expect(body.reference).toBeUndefined()
		expect(existsSync(join(root, 'data', 'out', 'orders', 'orders.jsonl'))).toBe(false)
	})

	it('rejects an unknown course', async () => {
		writeCatalog([{ slug: 'aws-saa', title: 'AWS SAA', price: '10.00' }])
		const res = await post({ email: 'b@x.com', courseSlug: 'not-a-course', method: 'paypal' })
		expect(res.status).toBe(404)
	})

	it('rejects malformed email, bad method, and injection-y slugs', async () => {
		writeCatalog([{ slug: 'aws-saa', title: 'AWS SAA', price: '10.00' }])
		expect((await post({ email: 'nope', courseSlug: 'aws-saa', method: 'paypal' })).status).toBe(400)
		expect((await post({ email: 'a@b.co', courseSlug: 'aws-saa', method: 'bitcoin' })).status).toBe(400)
		expect((await post({ email: 'a@b.co', courseSlug: '../../etc/passwd', method: 'paypal' })).status).toBe(400)
		expect((await post({ email: 'a@b.co', courseSlug: 'aws-saa/../x', method: 'paypal' })).status).toBe(400)
	})

	describe('admin lookup', () => {
		it('refuses GET without a valid operator token', async () => {
			writeCatalog([{ slug: 'aws-saa', title: 'AWS SAA', price: '10.00' }])
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
			writeCatalog([{ slug: 'aws-saa', title: 'AWS SAA', price: '55.00' }])
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
