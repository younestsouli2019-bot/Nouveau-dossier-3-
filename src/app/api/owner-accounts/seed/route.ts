import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

const SEED_ACCOUNTS = [
  // === Bank Wire Accounts (2 real) ===
  {
    label: 'Moroccan Bank — RIB 372',
    accountType: 'bank_wire',
    isActive: true,
    isPrimary: true,
    sortOrder: 1,
    purposes: 'salary,settlements,reconciliation',
    accountHolder: 'Younes Tsouli',
    accountNumber: '007810000448200061321372',
    accountNumberLast: '372',
    bankName: 'Attijariwafa Bank',
    bankCode: '00781',
    swiftCode: 'BCMAMAMC',
    countryCode: 'MA',
    currency: 'MAD',
  },
  {
    label: 'Banking Circle — Primary',
    accountType: 'bank_wire',
    isActive: true,
    isPrimary: true,
    sortOrder: 5,
    purposes: 'settlements,general',
    accountHolder: 'Younes Tsouli',
    accountNumberLast: '646',
    bankName: 'Banking Circle S.A.',
    swiftCode: 'BCIRLULL',
    countryCode: 'LU',
    currency: 'USD',
  },

  // === Crypto Wallet (1 real) ===
  {
    label: 'USDC on Arbitrum',
    accountType: 'l2_crypto',
    isActive: true,
    isPrimary: false,
    sortOrder: 3,
    purposes: 'crypto_settlement,settlements',
    network: 'Arbitrum',
    walletAddress: '0xA46225a984E2B2B5E5082E52AE8d8915A09fEfe7',
    walletAddressShort: '0xA462...Efe7',
    preferredToken: 'USDC',
    chainId: 42161,
    currency: 'USD',
  },

  // === PayPal (1 real) ===
  {
    label: 'PayPal Business',
    accountType: 'paypal',
    isActive: true,
    isPrimary: false,
    sortOrder: 2,
    purposes: 'settlements,general',
    paypalEmail: 'younestsouli2019@gmail.com',
    paypalType: 'business',
    paypalCountry: 'MA',
    currency: 'USD',
  },

  // === Payoneer (1 real) ===
  {
    label: 'Payoneer — Supplier Payments',
    accountType: 'payoneer',
    isActive: true,
    isPrimary: false,
    sortOrder: 4,
    purposes: 'vendor_payments',
    payoneerId: 'younestsouli2019@gmail.com',
    currency: 'USD',
  },
]

interface SeedSettlement {
  ownerAccountIdx: number
  referenceId: string
  amount: number
  currency: string
  status: string
  direction: string
  purpose: string
  description: string
  sourceLabel: string
  destinationLabel: string
  fee: number
  netAmount: number
  exchangeRate: number | null
  settledAt: Date | null
  createdAt: Date
}

const SEED_SETTLEMENTS: SeedSettlement[] = []

export async function POST() {
  try {
    // Check for existing data
    const existingCount = await db.ownerAccount.count()
    if (existingCount > 0) {
      return NextResponse.json({
        success: true,
        message: 'Seed skipped: owner accounts already exist',
        existingCount,
      })
    }

    // Create all accounts
    const accounts = []
    for (const acc of SEED_ACCOUNTS) {
      const created = await db.ownerAccount.create({ data: acc })
      accounts.push(created)
    }

    // Create settlements linked to the created accounts
    const settlements = []
    for (const s of SEED_SETTLEMENTS) {
      const accountId = accounts[s.ownerAccountIdx].id
      const settlement = await db.ownerSettlement.create({
        data: {
          ownerAccountId: accountId,
          referenceId: s.referenceId,
          amount: s.amount,
          currency: s.currency,
          status: s.status,
          direction: s.direction,
          purpose: s.purpose,
          description: s.description,
          sourceLabel: s.sourceLabel,
          destinationLabel: s.destinationLabel,
          fee: s.fee,
          netAmount: s.netAmount,
          exchangeRate: s.exchangeRate,
          settledAt: s.settledAt,
          createdAt: s.createdAt,
        },
      })
      settlements.push(settlement)
    }

    // Update account aggregate stats
    for (const acc of accounts) {
      const accSettlements = settlements.filter((s) => s.ownerAccountId === acc.id)
      const completed = accSettlements.filter((s) => s.status === 'completed')
      const totalReceived = completed
        .filter((s) => s.direction === 'inbound')
        .reduce((sum, s) => sum + (s.netAmount || s.amount), 0)
      const totalSent = completed
        .filter((s) => s.direction === 'outbound')
        .reduce((sum, s) => sum + (s.netAmount || s.amount), 0)

      await db.ownerAccount.update({
        where: { id: acc.id },
        data: {
          totalReceived,
          totalSent,
          txCount: accSettlements.length,
          lastUsedAt: accSettlements.length > 0
            ? accSettlements[accSettlements.length - 1].createdAt
            : null,
        },
      })
    }

    return NextResponse.json({
      success: true,
      message: `Seeded ${accounts.length} owner accounts and ${settlements.length} settlements`,
      accountsSeeded: accounts.length,
      settlementsSeeded: settlements.length,
    })
  } catch (error) {
    console.error('Error seeding owner accounts:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to seed owner accounts' },
      { status: 500 }
    )
  }
}