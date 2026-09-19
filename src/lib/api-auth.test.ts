import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { requireOpsAuth } from './api-auth'

const ORIGINAL_ENV = { ...process.env }

function makeRequest(headers: Record<string, string> = {}) {
  return new NextRequest('https://ops.example.test/api/shipments/verify', {
    method: 'POST',
    headers,
  })
}

describe('requireOpsAuth', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV }
    delete process.env.OPS_API_SECRET
    delete process.env.CRON_SECRET
    delete process.env.OPERATOR_TOKEN
    process.env.NODE_ENV = 'production'
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('rejects spoofed sec-fetch-site headers in production', async () => {
    process.env.OPS_API_SECRET = 'ops-secret'

    const denied = requireOpsAuth(
      makeRequest({ 'sec-fetch-site': 'same-origin' }),
    )

    expect(denied?.status).toBe(401)
    await expect(denied?.json()).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('x-ops-secret'),
    })
  })

  it('accepts a matching x-ops-secret header', () => {
    process.env.OPS_API_SECRET = 'ops-secret'

    const denied = requireOpsAuth(
      makeRequest({ 'x-ops-secret': 'ops-secret' }),
    )

    expect(denied).toBeNull()
  })

  it('accepts a matching bearer token', () => {
    process.env.OPERATOR_TOKEN = 'operator-token'

    const denied = requireOpsAuth(
      makeRequest({ authorization: 'Bearer operator-token' }),
    )

    expect(denied).toBeNull()
  })

  it('accepts a matching operator session cookie', () => {
    process.env.OPERATOR_TOKEN = 'operator-token'

    const denied = requireOpsAuth(
      makeRequest({ cookie: 'operator_session=operator-token' }),
    )

    expect(denied).toBeNull()
  })

  it('keeps same-origin browser fallback in local development', () => {
    process.env.NODE_ENV = 'development'

    const denied = requireOpsAuth(
      makeRequest({ 'sec-fetch-site': 'same-origin' }),
    )

    expect(denied).toBeNull()
  })
})
