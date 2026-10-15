// Guards M-1: protected money POSTs must fail CLOSED when OPERATOR_TOKEN is
// absent. `isDev = NODE_ENV !== 'production'` treated an UNSET NODE_ENV as dev,
// which waved through every protected money POST without authentication.
import { describe, it, expect, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from './middleware'

const ORIGINAL_NODE_ENV = process.env.NODE_ENV
const ORIGINAL_OPERATOR_TOKEN = process.env.OPERATOR_TOKEN

const req = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(new URL(`http://localhost${path}`), { method: 'POST', headers })

afterEach(() => {
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV
  if (ORIGINAL_OPERATOR_TOKEN === undefined) delete process.env.OPERATOR_TOKEN
  else process.env.OPERATOR_TOKEN = ORIGINAL_OPERATOR_TOKEN
})

describe('middleware — protected money POSTs fail closed', async () => {
  it('NODE_ENV unset + no OPERATOR_TOKEN -> 401 (this was the fail-open)', async () => {
    delete process.env.NODE_ENV
    delete process.env.OPERATOR_TOKEN

    const res = await middleware(req('/api/revenue/strict'))

    expect(res.status).toBe(401)
  })

  it('NODE_ENV=production + no OPERATOR_TOKEN -> 401', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.OPERATOR_TOKEN

    const res = await middleware(req('/api/revenue/strict'))

    expect(res.status).toBe(401)
  })

  it('NODE_ENV=development + no OPERATOR_TOKEN -> allowed (dev only)', async () => {
    process.env.NODE_ENV = 'development'
    delete process.env.OPERATOR_TOKEN

    const res = await middleware(req('/api/revenue/strict'))

    expect(res.status).not.toBe(401)
  })

  it('correct bearer token -> allowed', async () => {
    process.env.NODE_ENV = 'production'
    process.env.OPERATOR_TOKEN = 'tok_abc123'

    const res = await middleware(req('/api/revenue/strict', { authorization: 'Bearer tok_abc123' }))

    expect(res.status).not.toBe(401)
  })

  it('wrong bearer token -> 401', async () => {
    process.env.NODE_ENV = 'production'
    process.env.OPERATOR_TOKEN = 'tok_abc123'

    const res = await middleware(req('/api/revenue/strict', { authorization: 'Bearer wrong' }))

    expect(res.status).toBe(401)
  })

  it('unprotected path is untouched', async () => {
    delete process.env.NODE_ENV
    delete process.env.OPERATOR_TOKEN

    const res = await middleware(req('/api/healthz'))

    expect(res.status).not.toBe(401)
  })
})
