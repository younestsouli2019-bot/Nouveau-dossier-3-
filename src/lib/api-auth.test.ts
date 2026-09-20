import { beforeEach, describe, expect, it } from 'vitest'
import type { NextRequest } from 'next/server'
import { requireOpsAuth } from './api-auth'

function makeRequest(headers: HeadersInit = {}): NextRequest {
  return { headers: new Headers(headers) } as unknown as NextRequest
}

describe('requireOpsAuth', () => {
  beforeEach(() => {
    delete process.env.OPS_API_SECRET
    delete process.env.CRON_SECRET
    delete process.env.OPERATOR_TOKEN
  })

  it('rejects spoofed same-origin browser headers without a real secret or operator token', async () => {
    process.env.OPS_API_SECRET = 'ops-secret'

    const denied = requireOpsAuth(
      makeRequest({
        'sec-fetch-site': 'same-origin',
      }),
    )

    expect(denied).not.toBeNull()
    expect(denied?.status).toBe(401)
    await expect(denied?.json()).resolves.toMatchObject({ success: false })
  })

  it('accepts x-ops-secret when it matches OPS_API_SECRET', () => {
    process.env.OPS_API_SECRET = 'ops-secret'

    const denied = requireOpsAuth(
      makeRequest({
        'x-ops-secret': 'ops-secret',
      }),
    )

    expect(denied).toBeNull()
  })

  it('accepts operator bearer and cookie tokens', () => {
    process.env.OPERATOR_TOKEN = 'operator-token'

    const bearer = requireOpsAuth(
      makeRequest({
        authorization: 'Bearer operator-token',
      }),
    )
    const cookie = requireOpsAuth(
      makeRequest({
        cookie: 'other=1; operator_session=operator-token',
      }),
    )

    expect(bearer).toBeNull()
    expect(cookie).toBeNull()
  })
})
