import { afterEach, describe, expect, it } from 'vitest'
import type { NextRequest } from 'next/server'
import { requireOpsAuth } from './api-auth'

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return {
    headers: new Headers(headers),
  } as unknown as NextRequest
}

describe('requireOpsAuth', () => {
  const originalOpsSecret = process.env.OPS_API_SECRET
  const originalCronSecret = process.env.CRON_SECRET

  afterEach(() => {
    if (originalOpsSecret === undefined) {
      delete process.env.OPS_API_SECRET
    } else {
      process.env.OPS_API_SECRET = originalOpsSecret
    }

    if (originalCronSecret === undefined) {
      delete process.env.CRON_SECRET
    } else {
      process.env.CRON_SECRET = originalCronSecret
    }
  })

  it('allows requests with the configured ops secret header', () => {
    process.env.OPS_API_SECRET = 'top-secret'
    delete process.env.CRON_SECRET

    const response = requireOpsAuth(
      makeRequest({
        'x-ops-secret': ' top-secret ',
        'sec-fetch-site': 'cross-site',
      }),
    )

    expect(response).toBeNull()
  })

  it('falls back to CRON_SECRET when OPS_API_SECRET is not set', () => {
    delete process.env.OPS_API_SECRET
    process.env.CRON_SECRET = 'cron-secret'

    const response = requireOpsAuth(
      makeRequest({
        'x-ops-secret': 'cron-secret',
      }),
    )

    expect(response).toBeNull()
  })

  it('allows same-origin browser requests without a secret header', () => {
    delete process.env.OPS_API_SECRET
    delete process.env.CRON_SECRET

    const response = requireOpsAuth(
      makeRequest({
        'sec-fetch-site': 'same-origin',
      }),
    )

    expect(response).toBeNull()
  })

  it('rejects cross-site requests when the provided secret length does not match', async () => {
    process.env.OPS_API_SECRET = 'abcdef'
    delete process.env.CRON_SECRET

    const response = requireOpsAuth(
      makeRequest({
        'x-ops-secret': 'abc',
        'sec-fetch-site': 'cross-site',
      }),
    )

    expect(response?.status).toBe(401)
    await expect(response?.json()).resolves.toMatchObject({
      success: false,
    })
  })

  it('rejects unauthenticated cross-site requests before business logic runs', async () => {
    delete process.env.OPS_API_SECRET
    delete process.env.CRON_SECRET

    const response = requireOpsAuth(
      makeRequest({
        'sec-fetch-site': 'cross-site',
      }),
    )

    expect(response?.status).toBe(401)
    await expect(response?.json()).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('same-origin request'),
    })
  })
})
