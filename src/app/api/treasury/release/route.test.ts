import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireOpsAuth = vi.fn()
const getOwnerLedgerStatus = vi.fn()
const confirmRelease = vi.fn()
const releaseOwnerFunds = vi.fn()

vi.mock('@/lib/api-auth', () => ({
  requireOpsAuth,
}))

vi.mock('@/lib/treasury/release-engine', () => ({
  getOwnerLedgerStatus,
  confirmRelease,
  releaseOwnerFunds,
}))

describe('/api/treasury/release', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    requireOpsAuth.mockReturnValue(null)
    getOwnerLedgerStatus.mockResolvedValue([
      { id: 'acct-1', heldBalance: 500, spendableBalance: 100, totalSent: 75 },
    ])
    confirmRelease.mockResolvedValue({
      ok: true,
      status: 'completed',
      idempotentReplay: true,
      railUsed: 'mad_manual_operator_mobile',
    })
    releaseOwnerFunds.mockResolvedValue({
      ok: true,
      status: 'completed',
    })
  })

  it('returns the auth failure before touching ledger data', async () => {
    requireOpsAuth.mockReturnValue(
      new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const { GET } = await import('@/app/api/treasury/release/route')

    const response = await GET({ headers: new Headers() } as never)
    expect(response.status).toBe(401)
    expect(getOwnerLedgerStatus).not.toHaveBeenCalled()
  })

  it('rejects confirm requests that omit externalRef', async () => {
    const { POST } = await import('@/app/api/treasury/release/route')

    const response = await POST({
      headers: new Headers([['sec-fetch-site', 'same-origin']]),
      json: vi.fn().mockResolvedValue({ op: 'confirm' }),
    } as never)

    expect(response.status).toBe(400)
    expect(confirmRelease).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: 'externalRef required for confirm',
    })
  })

  it('passes valid confirm requests through to confirmRelease', async () => {
    const { POST } = await import('@/app/api/treasury/release/route')

    const response = await POST({
      headers: new Headers([['x-ops-secret', 'ops-secret']]),
      json: vi.fn().mockResolvedValue({
        op: 'confirm',
        externalRef: 'WPS2026091900001',
      }),
    } as never)

    expect(response.status).toBe(200)
    expect(confirmRelease).toHaveBeenCalledWith('WPS2026091900001')
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      ok: true,
      status: 'completed',
      idempotentReplay: true,
      railUsed: 'mad_manual_operator_mobile',
    })
  })
})
