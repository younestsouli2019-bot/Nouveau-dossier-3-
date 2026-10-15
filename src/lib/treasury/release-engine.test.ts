// Guards the 4-ledger invariant that dies silently if untested: value may only
// move OwnerAccount.heldBalance -> spendableBalance after a REAL bank paymentId.
//
// Why this file exists: `src/payout/__tests__/owner-payout.test.ts` (529 lines)
// was present on `main` but is absent from `release`, and it targets a removed
// engine API (getOwnerAccountForBucket / build*LiveConfig / idempotentReplay /
// /api/payouts/status). Restoring it verbatim would not compile. This test
// re-establishes the same protection against the current release-engine API.
//
// Fail-closed rule under test: whenever no real payment reference comes back
// from Attijari, heldBalance MUST be left untouched (no ownerAccount.update).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const ENV_KEYS = [
  'LIVE_BANK_API',
  'OWNER_PAYOUT_IDENTIFIER',
  'OWNER_IBAN',
  'IBAN_BC',
  'OWNER_PAYOUT_HOLDER_NAME',
  'OWNER_NAME',
  'OWNER_PAYOUT_CURRENCY',
] as const

const ORIGINAL_ENV: Record<string, string | undefined> = {}
for (const k of ENV_KEYS) ORIGINAL_ENV[k] = process.env[k]

const REAL_IBAN = 'MA64011519000001205000534921'

const harness = () => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  settlementCreate: vi.fn(),
  auditCreate: vi.fn(),
  initiatePayment: vi.fn(),
})
type Harness = ReturnType<typeof harness>

const OWNER = {
  id: 'own_1',
  isActive: true,
  heldBalance: 1000,
  accountType: 'attijari',
  accountNumber: REAL_IBAN,
  accountHolder: 'Younes Tsouli',
  label: 'Contentieux 018',
  walletAddress: null as string | null,
  network: null as string | null,
}

/**
 * release-engine reads LIVE_BANK_API / OWNER_* at MODULE LOAD, so env must be
 * set before the dynamic import and modules reset between cases.
 */
async function loadEngine(h: Harness, env: Partial<Record<string, string>>) {
  vi.resetModules()
  for (const k of ENV_KEYS) delete process.env[k]
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v

  vi.doMock('../db', () => ({
    prisma: {
      ownerAccount: { findUnique: h.findUnique, update: h.update },
      fundBucket: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn() },
      ownerSettlement: { create: h.settlementCreate },
      auditLedger: { create: h.auditCreate },
    },
  }))
  vi.doMock('../attijariwafa-psd2', () => ({
    initiatePayment: h.initiatePayment,
    getPaymentStatus: vi.fn(),
  }))

  return await import('./release-engine')
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (ORIGINAL_ENV[k] === undefined) delete process.env[k]
    else process.env[k] = ORIGINAL_ENV[k] as string
  }
  vi.doUnmock('../db')
  vi.doUnmock('../attijariwafa-psd2')
  vi.resetModules()
})

describe('release-engine — held -> spendable requires a real bank paymentId', () => {
  it('rejects a non-positive amount without reading or writing balances', async () => {
    const h = harness()
    const { releaseOwnerFunds } = await loadEngine(h, { LIVE_BANK_API: 'true' })

    const res = await releaseOwnerFunds({ ownerAccountId: 'own_1', amount: 0 })

    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/must be positive/i)
    expect(h.findUnique).not.toHaveBeenCalled()
    expect(h.update).not.toHaveBeenCalled()
    expect(h.initiatePayment).not.toHaveBeenCalled()
  })

  it('refuses an unknown OwnerAccount', async () => {
    const h = harness()
    h.findUnique.mockResolvedValue(null)
    const { releaseOwnerFunds } = await loadEngine(h, { LIVE_BANK_API: 'true' })

    const res = await releaseOwnerFunds({ ownerAccountId: 'missing', amount: 10 })

    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/not found/i)
    expect(h.update).not.toHaveBeenCalled()
  })

  it('refuses an inactive OwnerAccount', async () => {
    const h = harness()
    h.findUnique.mockResolvedValue({ ...OWNER, isActive: false })
    const { releaseOwnerFunds } = await loadEngine(h, { LIVE_BANK_API: 'true', OWNER_PAYOUT_IDENTIFIER: REAL_IBAN })

    const res = await releaseOwnerFunds({ ownerAccountId: 'own_1', amount: 10 })

    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/not active/i)
    expect(h.update).not.toHaveBeenCalled()
  })

  it('refuses to release more than heldBalance (held is the only releasable pool)', async () => {
    const h = harness()
    h.findUnique.mockResolvedValue({ ...OWNER, heldBalance: 100 })
    const { releaseOwnerFunds } = await loadEngine(h, { LIVE_BANK_API: 'true', OWNER_PAYOUT_IDENTIFIER: REAL_IBAN })

    const res = await releaseOwnerFunds({ ownerAccountId: 'own_1', amount: 500 })

    expect(res.ok).toBe(false)
    expect(res.reason).toMatch(/Insufficient HELD/)
    expect(h.update).not.toHaveBeenCalled()
    expect(h.initiatePayment).not.toHaveBeenCalled()
  })

  it('fails closed when LIVE_BANK_API is not configured', async () => {
    const h = harness()
    h.findUnique.mockResolvedValue({ ...OWNER })
    const { releaseOwnerFunds } = await loadEngine(h, {})

    const res = await releaseOwnerFunds({ ownerAccountId: 'own_1', amount: 100 })

    expect(res.ok).toBe(false)
    expect(res.status).toBe('needs_manual_proof')
    expect(res.reason).toMatch(/LIVE_BANK_API not configured/)
    expect(h.update).not.toHaveBeenCalled()
    expect(h.initiatePayment).not.toHaveBeenCalled()
  })

  it('fails closed when the bank returns no real paymentId — heldBalance must stay untouched', async () => {
    const h = harness()
    h.findUnique.mockResolvedValue({ ...OWNER })
    h.initiatePayment.mockResolvedValue({ paymentId: 'PLACEHOLDER', status: 'refused' })
    const { releaseOwnerFunds } = await loadEngine(h, { LIVE_BANK_API: 'true', OWNER_PAYOUT_IDENTIFIER: REAL_IBAN })

    const res = await releaseOwnerFunds({ ownerAccountId: 'own_1', amount: 100 })

    expect(res.ok).toBe(false)
    expect(res.status).toBe('needs_manual_proof')
    expect(res.reason).toMatch(/no real paymentId/i)
    expect(h.update).not.toHaveBeenCalled()
    expect(h.settlementCreate).not.toHaveBeenCalled()
  })

  it('fails closed when the bank rail throws', async () => {
    const h = harness()
    h.findUnique.mockResolvedValue({ ...OWNER })
    h.initiatePayment.mockRejectedValue(new Error('PISP unreachable'))
    const { releaseOwnerFunds } = await loadEngine(h, { LIVE_BANK_API: 'true', OWNER_PAYOUT_IDENTIFIER: REAL_IBAN })

    const res = await releaseOwnerFunds({ ownerAccountId: 'own_1', amount: 100 })

    expect(res.ok).toBe(false)
    expect(res.status).toBe('needs_manual_proof')
    expect(h.update).not.toHaveBeenCalled()
  })

  it('moves held -> spendable ONLY on a real payment reference', async () => {
    const h = harness()
    h.findUnique.mockResolvedValue({ ...OWNER })
    h.initiatePayment.mockResolvedValue({ paymentId: 'ATTJ20261014000042', status: 'accepted' })
    h.update.mockResolvedValue({})
    h.settlementCreate.mockResolvedValue({ id: 'set_1' })
    h.auditCreate.mockResolvedValue({})
    const { releaseOwnerFunds } = await loadEngine(h, { LIVE_BANK_API: 'true', OWNER_PAYOUT_IDENTIFIER: REAL_IBAN })

    const res = await releaseOwnerFunds({ ownerAccountId: 'own_1', amount: 250 })

    expect(res.ok).toBe(true)
    expect(res.externalRef).toBe('ATTJ20261014000042')
    expect(res.dataSource).toBe('live_bank_api')
    expect(h.update).toHaveBeenCalledTimes(1)

    const data = h.update.mock.calls[0][0].data
    expect(data.heldBalance).toEqual({ decrement: 250 })
    expect(data.spendableBalance).toEqual({ increment: 250 })
    expect(data.totalSent).toEqual({ increment: 250 })
  })
})
