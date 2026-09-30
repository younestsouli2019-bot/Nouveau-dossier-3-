import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { ownerAccountFindMany } = vi.hoisted(() => ({
  ownerAccountFindMany: vi.fn(),
}))

vi.mock('./db', () => ({
  prisma: {
    ownerAccount: {
      findMany: ownerAccountFindMany,
    },
  },
}))

import { resolveBestPayoutRoute, routeToPayoutRail } from './payout-resolver'

const ORIGINAL_ENV = { ...process.env }

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key]
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value
  }
}

beforeEach(() => {
  restoreEnv()
  ownerAccountFindMany.mockReset()
})

afterEach(() => {
  restoreEnv()
})

describe('resolveBestPayoutRoute', () => {
  it('prefers the lower-cost matching-currency DB route over a pricier primary account', async () => {
    ownerAccountFindMany.mockResolvedValue([
      {
        id: 'acct_paypal',
        label: 'Primary PayPal',
        accountType: 'paypal',
        currency: 'USD',
        totalSent: 1000,
        isPrimary: true,
        paypalEmail: 'owner@paypal.test',
      },
      {
        id: 'acct_crypto',
        label: 'USDC Arbitrum',
        accountType: 'l2_crypto',
        currency: 'USD',
        totalSent: 150,
        isPrimary: false,
        walletAddress: '0xabc123',
      },
    ])

    const result = await resolveBestPayoutRoute('USD')

    expect(result.source).toBe('db')
    expect(result.best?.ownerAccountId).toBe('acct_crypto')
    expect(result.best?.rail).toBe('l2_crypto')
    expect(result.best?.requiresFxConversion).toBe(false)
    expect(result.ranked.map(route => route.ownerAccountId)).toEqual(['acct_crypto', 'acct_paypal'])
  })

  it('falls back to the env preset when the DB lookup throws', async () => {
    ownerAccountFindMany.mockRejectedValue(new Error('db offline'))
    process.env.OWNER_PAYOUT_RAIL = 'crypto'
    process.env.OWNER_PAYOUT_CURRENCY = 'EUR'
    process.env.OWNER_PAYOUT_IDENTIFIER = 'wallet_abcdef123456'
    process.env.OWNER_PAYOUT_COUNTRY = 'FR'
    process.env.OWNER_PAYOUT_HOLDER_NAME = 'Owner Name'

    const result = await resolveBestPayoutRoute('USD')

    expect(result.source).toBe('env')
    expect(result.best).toMatchObject({
      label: 'Env preset',
      rail: 'crypto',
      currency: 'EUR',
      requiresFxConversion: true,
    })
    expect(result.best?.identifier).toMatch(/^wa\*+3456$/)
  })

  it('returns a no-route result when neither DB accounts nor env preset exist', async () => {
    ownerAccountFindMany.mockResolvedValue([])

    const result = await resolveBestPayoutRoute('USD')

    expect(result).toEqual({
      best: null,
      ranked: [],
      reason: 'No active pre-set owner route available (DB empty AND OWNER_PAYOUT_* env preset missing).',
      source: 'none',
    })
  })
})

describe('routeToPayoutRail', () => {
  it('maps rail aliases into the owner payout vocabulary', () => {
    expect(routeToPayoutRail('l2_crypto')).toBe('crypto')
    expect(routeToPayoutRail('bank_wire')).toBe('iban')
    expect(routeToPayoutRail('unknown')).toBe('iban')
  })
})
