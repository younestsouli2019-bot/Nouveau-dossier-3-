import { beforeEach, describe, expect, it, vi } from 'vitest'

const getOwnerLedgerStatus = vi.fn()
const payoutGroupBy = vi.fn()
const payoutAggregate = vi.fn()
const ownerPaymentCount = vi.fn()
const ownerSettlementCount = vi.fn()
const ownerSettlementFindMany = vi.fn()

vi.mock('@/lib/db', () => ({
  db: {
    payout: {
      groupBy: payoutGroupBy,
      aggregate: payoutAggregate,
    },
    ownerPayment: {
      count: ownerPaymentCount,
    },
    ownerSettlement: {
      count: ownerSettlementCount,
      findMany: ownerSettlementFindMany,
    },
  },
}))

vi.mock('@/lib/treasury/release-engine', () => ({
  getOwnerLedgerStatus,
}))

describe('/api/payouts/status', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    const missingPayoutTable = Object.assign(
      new Error('The table public.Payout does not exist in the current database.'),
      { code: 'P2021' },
    )

    payoutGroupBy.mockRejectedValue(missingPayoutTable)
    payoutAggregate.mockRejectedValue(missingPayoutTable)

    ownerPaymentCount.mockImplementation(async ({ where }: { where?: { status?: string | { in?: string[] } } }) => {
      if (where?.status === 'stuck_in_transition') return 1
      if (typeof where?.status === 'object' && where.status?.in?.includes('pending')) return 2
      if (where?.status === 'processing') return 0
      return 0
    })

    ownerSettlementCount.mockImplementation(
      async ({
        where,
      }: {
        where?: {
          status?: string
          connectorStatus?: string | { in?: string[] }
          OR?: unknown[]
        }
      }) => {
        if (where?.connectorStatus === 'manual_attested_pending' && where?.status === 'processing') return 2
        if (where?.status === 'completed') return 1
        if (where?.OR) return 2
        return 0
      },
    )

    ownerSettlementFindMany.mockImplementation(
      async ({
        where,
        select,
      }: {
        where?: { ownerAccountId?: string; status?: string; OR?: unknown[] }
        select?: { metadata?: boolean }
      }) => {
        if (where?.ownerAccountId === 'acct-1' && where?.OR) {
          return [{ amount: 150 }]
        }
        if (where?.ownerAccountId === 'acct-1' && where?.status === 'completed') {
          return [{ amount: 75 }]
        }
        if (select?.metadata) {
          return [
            {
              status: 'processing',
              amount: 150,
              settledAt: null,
              metadata: JSON.stringify({ bucketCode: 'salary_bucket' }),
              connectorStatus: 'manual_attested_pending',
            },
            {
              status: 'completed',
              amount: 75,
              settledAt: new Date('2026-09-20T10:00:00.000Z'),
              metadata: JSON.stringify({ bucketCode: 'salary_bucket' }),
              connectorStatus: 'manual_attested_finance',
            },
          ]
        }
        return []
      },
    )

    getOwnerLedgerStatus.mockResolvedValue([
      {
        id: 'acct-1',
        label: 'Salary MAD',
        accountType: 'bank_wire',
        accountNumberLast: '182',
        currency: 'MAD',
        railReady: true,
      },
    ])
  })

  it('returns owner-settlement metrics even when payout tables are missing', async () => {
    const { GET } = await import('@/app/api/payouts/status/route')

    const response = await GET()
    expect(response.status).toBe(200)

    const json = (await response.json()) as {
      ok: boolean
      summary: Record<string, number>
      byRail: Record<string, Record<string, number>>
      byBucket: Record<string, Record<string, number>>
      byOwnerAccount: Array<Record<string, unknown>>
    }

    expect(json.ok).toBe(true)
    expect(json.summary).toMatchObject({
      stuckCount: 1,
      pendingCount: 4,
      processingCount: 0,
      completedCount: 0,
      totalAmountCompleted24h: 0,
    })
    expect(json.byRail.manual_mad).toEqual({
      pending: 2,
      processing: 0,
      completed24h: 1,
      stuck: 0,
    })
    expect(json.byBucket.salary).toMatchObject({
      pending: 1,
      processing: 0,
      completed24h: 1,
      pendingAmount: 150,
      completedAmount24h: 75,
    })
    expect(json.byOwnerAccount).toEqual([
      {
        id: 'acct-1',
        label: 'Salary MAD',
        accountType: 'bank_wire',
        last4: '182',
        currency: 'MAD',
        pendingCount: 1,
        pendingAmount: 150,
        completed24h: 1,
        completedAmount24h: 75,
        railReady: true,
      },
    ])
  })
})
