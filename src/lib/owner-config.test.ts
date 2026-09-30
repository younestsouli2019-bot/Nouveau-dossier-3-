import { afterEach, describe, expect, it } from 'vitest'
import {
  getDisbursementPolicy,
  getPresetPayoutDestination,
  isOwnerConfigured,
  requireOwnerConfig,
  tryGetOwnerEmail,
} from './owner-config'

const ORIGINAL_ENV = { ...process.env }

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key]
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value
  }
}

afterEach(() => {
  restoreEnv()
})

describe('owner-config identity guards', () => {
  it('requires trimmed owner identity and exposes normalized fields', () => {
    process.env.OWNER_NAME = '  Younes Tsouli  '
    process.env.OWNER_EMAIL = '  owner@example.org  '

    expect(isOwnerConfigured()).toBe(true)
    expect(requireOwnerConfig()).toEqual({
      name: 'Younes Tsouli',
      email: 'owner@example.org',
      nameUpper: 'YOUNES TSOULI',
      displayName: 'Younes Tsouli OWNER',
    })
  })

  it('treats placeholder emails as not configured in safe and strict paths', () => {
    process.env.OWNER_NAME = 'Owner Name'
    process.env.OWNER_EMAIL = 'owner@example.com'

    expect(tryGetOwnerEmail()).toBeNull()
    expect(isOwnerConfigured()).toBe(false)
    expect(() => requireOwnerConfig()).toThrow(/OWNER_EMAIL secret is not configured/)
  })
})

describe('owner-config payout policy', () => {
  it('builds a preset destination and ignores unsupported crypto networks', () => {
    process.env.OWNER_PAYOUT_RAIL = 'crypto'
    process.env.OWNER_PAYOUT_CURRENCY = 'USD'
    process.env.OWNER_PAYOUT_IDENTIFIER = 'wallet_123456'
    process.env.OWNER_PAYOUT_COUNTRY = 'US'
    process.env.OWNER_PAYOUT_HOLDER_NAME = 'Owner Name'
    process.env.OWNER_PAYOUT_CRYPTO_NET = 'unsupported-net'

    expect(getPresetPayoutDestination()).toEqual({
      rail: 'crypto',
      currency: 'USD',
      identifier: 'wallet_123456',
      country: 'US',
      holderName: 'Owner Name',
      bic: undefined,
      routingNumber: undefined,
      cryptoNetwork: undefined,
    })
  })

  it('clamps fee and reserve values while defaulting an invalid schedule', () => {
    process.env.OWNER_PAYOUT_SCHEDULE = 'fortnightly'
    process.env.OWNER_PAYOUT_FEE_BPS = '12000'
    process.env.OWNER_FRAUD_WINDOW_HOLD_HOURS = '-8'
    process.env.OWNER_CHARGEBACK_RESERVE_PCT = '250'

    expect(getDisbursementPolicy()).toEqual({
      schedule: 'instant',
      platformFeeBps: 10000,
      fraudWindowHoldHours: 0,
      chargebackReservePct: 100,
      bucketPct: {
        sovereignReserves: 30,
        procurementBuffer: 0,
        runtimeOperations: 20,
        salary: 10,
        debtRepayment: 40,
      },
    })
  })

  it('fails closed when treasury bucket percentages exceed 100%', () => {
    process.env.OWNER_BUCKET_SOVEREIGN_PCT = '30'
    process.env.OWNER_BUCKET_PROCUREMENT_PCT = '10'
    process.env.OWNER_BUCKET_RUNTIME_PCT = '20'
    process.env.OWNER_BUCKET_SALARY_PCT = '10'
    process.env.OWNER_BUCKET_DEBT_REPAYMENT_PCT = '40'

    expect(() => getDisbursementPolicy()).toThrow(/must sum to 100/)
  })
})
