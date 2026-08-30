import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

const SEED_ACCOUNTS = [
  // === Bank Wire Accounts (3) ===
  {
    label: 'Salary - Attijariwafa',
    accountType: 'bank_wire',
    isActive: true,
    isPrimary: true,
    sortOrder: 1,
    purposes: 'salary',
    accountHolder: 'Younes Tsouli',
    accountNumber: '007810000448200061321372',
    accountNumberLast: '1372',
    bankName: 'Attijariwafa Bank',
    bankCode: '00781',
    swiftCode: 'BCMAMAMC',
    countryCode: 'MA',
    currency: 'MAD',
  },
  {
    label: 'Settlements - Banque Populaire',
    accountType: 'bank_wire',
    isActive: true,
    isPrimary: false,
    sortOrder: 2,
    purposes: 'settlements,reconciliation',
    accountHolder: 'Younes Tsouli',
    accountNumber: '000410000448200061321372',
    accountNumberLast: '1372',
    bankName: 'Banque Populaire',
    bankCode: '00041',
    swiftCode: 'BPCEMCMC',
    countryCode: 'MA',
    currency: 'MAD',
  },
  {
    label: 'USD Wire - Chase Bank',
    accountType: 'bank_wire',
    isActive: true,
    isPrimary: false,
    sortOrder: 3,
    purposes: 'general,settlements',
    accountHolder: 'Younes Tsouli',
    accountNumber: '0210000211234567',
    accountNumberLast: '4567',
    bankName: 'JPMorgan Chase Bank',
    routingNumber: '021000021',
    swiftCode: 'CHASUS33',
    countryCode: 'US',
    currency: 'USD',
  },

  // === L2 Crypto Wallets (5) ===
  {
    label: 'USDC - Arbitrum',
    accountType: 'l2_crypto',
    isActive: true,
    isPrimary: true,
    sortOrder: 4,
    purposes: 'crypto_settlement,settlements',
    network: 'Arbitrum',
    walletAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f4E8A0',
    walletAddressShort: '0x742d...E8A0',
    preferredToken: 'USDC',
    chainId: 42161,
    currency: 'USD',
  },
  {
    label: 'USDT - Optimism',
    accountType: 'l2_crypto',
    isActive: true,
    isPrimary: false,
    sortOrder: 5,
    purposes: 'crypto_settlement',
    network: 'Optimism',
    walletAddress: '0x4200000000000000000000000000000000000006',
    walletAddressShort: '0x4200...0006',
    preferredToken: 'USDT',
    chainId: 10,
    currency: 'USD',
  },
  {
    label: 'ETH - Base',
    accountType: 'l2_crypto',
    isActive: true,
    isPrimary: false,
    sortOrder: 6,
    purposes: 'crypto_settlement',
    network: 'Base',
    walletAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    walletAddressShort: '0x8335...2913',
    preferredToken: 'ETH',
    chainId: 8453,
    currency: 'USD',
  },
  {
    label: 'USDC - Polygon',
    accountType: 'l2_crypto',
    isActive: true,
    isPrimary: false,
    sortOrder: 7,
    purposes: 'crypto_settlement,settlements',
    network: 'Polygon',
    walletAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    walletAddressShort: '0x3c49...3359',
    preferredToken: 'USDC',
    chainId: 137,
    currency: 'USD',
  },
  {
    label: 'WBTC - Linea',
    accountType: 'l2_crypto',
    isActive: true,
    isPrimary: false,
    sortOrder: 8,
    purposes: 'crypto_settlement',
    network: 'Linea',
    walletAddress: '0x95222290DD7278Aa3Ddd389Cc1E1d165CC4BAfe5',
    walletAddressShort: '0x9522...Afe5',
    preferredToken: 'WBTC',
    chainId: 59144,
    currency: 'USD',
  },

  // === PayPal (1) ===
  {
    label: 'PayPal Business',
    accountType: 'paypal',
    isActive: true,
    isPrimary: true,
    sortOrder: 9,
    purposes: 'settlements,general',
    paypalEmail: 'y.tsouli.business@gmail.com',
    paypalType: 'business',
    paypalCountry: 'MA',
    currency: 'USD',
  },

  // === Wise (1) ===
  {
    label: 'Wise - EUR',
    accountType: 'wise',
    isActive: true,
    isPrimary: false,
    sortOrder: 10,
    purposes: 'settlements,reconciliation',
    wiseEmail: 'younes@tsouli.com',
    wiseCurrency: 'EUR',
    currency: 'EUR',
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

const SEED_SETTLEMENTS: SeedSettlement[] = [
  // 5 completed salary settlements to Attijariwafa (monthly salary payments)
  {
    ownerAccountIdx: 0,
    referenceId: 'SAL-2025-01-001',
    amount: 25000,
    currency: 'MAD',
    status: 'completed',
    direction: 'inbound',
    purpose: 'salary',
    description: 'Monthly salary - January 2025',
    sourceLabel: 'Company Payroll',
    destinationLabel: 'RIB ...1372',
    fee: 0,
    netAmount: 25000,
    exchangeRate: null,
    settledAt: new Date('2025-01-31T10:00:00Z'),
    createdAt: new Date('2025-01-28T08:00:00Z'),
  },
  {
    ownerAccountIdx: 0,
    referenceId: 'SAL-2025-02-001',
    amount: 25000,
    currency: 'MAD',
    status: 'completed',
    direction: 'inbound',
    purpose: 'salary',
    description: 'Monthly salary - February 2025',
    sourceLabel: 'Company Payroll',
    destinationLabel: 'RIB ...1372',
    fee: 0,
    netAmount: 25000,
    exchangeRate: null,
    settledAt: new Date('2025-02-28T10:00:00Z'),
    createdAt: new Date('2025-02-25T08:00:00Z'),
  },
  {
    ownerAccountIdx: 0,
    referenceId: 'SAL-2025-03-001',
    amount: 27500,
    currency: 'MAD',
    status: 'completed',
    direction: 'inbound',
    purpose: 'salary',
    description: 'Monthly salary - March 2025 (with bonus)',
    sourceLabel: 'Company Payroll',
    destinationLabel: 'RIB ...1372',
    fee: 0,
    netAmount: 27500,
    exchangeRate: null,
    settledAt: new Date('2025-03-31T10:00:00Z'),
    createdAt: new Date('2025-03-28T08:00:00Z'),
  },
  {
    ownerAccountIdx: 0,
    referenceId: 'SAL-2025-04-001',
    amount: 25000,
    currency: 'MAD',
    status: 'completed',
    direction: 'inbound',
    purpose: 'salary',
    description: 'Monthly salary - April 2025',
    sourceLabel: 'Company Payroll',
    destinationLabel: 'RIB ...1372',
    fee: 0,
    netAmount: 25000,
    exchangeRate: null,
    settledAt: new Date('2025-04-30T10:00:00Z'),
    createdAt: new Date('2025-04-27T08:00:00Z'),
  },
  {
    ownerAccountIdx: 0,
    referenceId: 'SAL-2025-05-001',
    amount: 25000,
    currency: 'MAD',
    status: 'completed',
    direction: 'inbound',
    purpose: 'salary',
    description: 'Monthly salary - May 2025',
    sourceLabel: 'Company Payroll',
    destinationLabel: 'RIB ...1372',
    fee: 0,
    netAmount: 25000,
    exchangeRate: null,
    settledAt: new Date('2025-05-30T10:00:00Z'),
    createdAt: new Date('2025-05-28T08:00:00Z'),
  },

  // 3 completed USDC settlements on Arbitrum (crypto revenue)
  {
    ownerAccountIdx: 3,
    referenceId: '0xabc123def456789abc123def456789abc123def456789abc123def456789abcd',
    amount: 4200,
    currency: 'USD',
    status: 'completed',
    direction: 'inbound',
    purpose: 'settlement',
    description: 'Revenue settlement - USDC on Arbitrum',
    sourceLabel: 'Platform Revenue',
    destinationLabel: '0x742d...E8A0',
    fee: 0.85,
    netAmount: 4199.15,
    exchangeRate: null,
    settledAt: new Date('2025-04-15T14:30:00Z'),
    createdAt: new Date('2025-04-15T14:00:00Z'),
  },
  {
    ownerAccountIdx: 3,
    referenceId: '0xdef456789abc123def456789abc123def456789abc123def456789abc123def4',
    amount: 7350,
    currency: 'USD',
    status: 'completed',
    direction: 'inbound',
    purpose: 'settlement',
    description: 'Crypto revenue settlement - USDC batch',
    sourceLabel: 'Platform Revenue',
    destinationLabel: '0x742d...E8A0',
    fee: 1.20,
    netAmount: 7348.80,
    exchangeRate: null,
    settledAt: new Date('2025-05-02T09:15:00Z'),
    createdAt: new Date('2025-05-02T09:00:00Z'),
  },
  {
    ownerAccountIdx: 3,
    referenceId: '0x789abc123def456789abc123def456789abc123def456789abc123def456789a',
    amount: 3100,
    currency: 'USD',
    status: 'completed',
    direction: 'inbound',
    purpose: 'settlement',
    description: 'Affiliate payout - USDC on Arbitrum',
    sourceLabel: 'Affiliate Program',
    destinationLabel: '0x742d...E8A0',
    fee: 0.62,
    netAmount: 3099.38,
    exchangeRate: null,
    settledAt: new Date('2025-05-20T16:45:00Z'),
    createdAt: new Date('2025-05-20T16:30:00Z'),
  },

  // 2 completed settlements via PayPal
  {
    ownerAccountIdx: 8,
    referenceId: 'PP-8XJ29347LK561203B',
    amount: 1500,
    currency: 'USD',
    status: 'completed',
    direction: 'inbound',
    purpose: 'settlement',
    description: 'PayPal settlement - freelance payment',
    sourceLabel: 'Client Payment',
    destinationLabel: 'y.tsouli.business@gmail.com',
    fee: 43.65,
    netAmount: 1456.35,
    exchangeRate: null,
    settledAt: new Date('2025-04-10T11:00:00Z'),
    createdAt: new Date('2025-04-09T18:00:00Z'),
  },
  {
    ownerAccountIdx: 8,
    referenceId: 'PP-4RQ81263MN908745K',
    amount: 890,
    currency: 'USD',
    status: 'completed',
    direction: 'inbound',
    purpose: 'general',
    description: 'PayPal transfer - refund received',
    sourceLabel: 'Vendor Refund',
    destinationLabel: 'y.tsouli.business@gmail.com',
    fee: 0,
    netAmount: 890,
    exchangeRate: null,
    settledAt: new Date('2025-05-05T13:20:00Z'),
    createdAt: new Date('2025-05-05T12:00:00Z'),
  },

  // 2 completed settlements to Banque Populaire
  {
    ownerAccountIdx: 1,
    referenceId: 'BNK-POP-2025-0031',
    amount: 45000,
    currency: 'MAD',
    status: 'completed',
    direction: 'inbound',
    purpose: 'settlement',
    description: 'Vendor payment settlement - Banque Populaire',
    sourceLabel: 'Supply Chain Operations',
    destinationLabel: 'RIB ...1372',
    fee: 15,
    netAmount: 44985,
    exchangeRate: null,
    settledAt: new Date('2025-03-20T09:00:00Z'),
    createdAt: new Date('2025-03-18T14:00:00Z'),
  },
  {
    ownerAccountIdx: 1,
    referenceId: 'BNK-POP-2025-0045',
    amount: 32000,
    currency: 'MAD',
    status: 'completed',
    direction: 'inbound',
    purpose: 'reconciliation',
    description: 'Account reconciliation - Q1 2025',
    sourceLabel: 'Treasury',
    destinationLabel: 'RIB ...1372',
    fee: 10,
    netAmount: 31990,
    exchangeRate: null,
    settledAt: new Date('2025-04-02T10:30:00Z'),
    createdAt: new Date('2025-03-31T16:00:00Z'),
  },

  // 1 pending settlement to Chase Bank
  {
    ownerAccountIdx: 2,
    referenceId: 'CHASE-2025-0523',
    amount: 5200,
    currency: 'USD',
    status: 'pending',
    direction: 'inbound',
    purpose: 'settlement',
    description: 'USD wire transfer pending - Chase Bank',
    sourceLabel: 'International Client',
    destinationLabel: 'CHAS...4567',
    fee: 25,
    netAmount: 5175,
    exchangeRate: null,
    settledAt: null,
    createdAt: new Date('2025-05-23T08:00:00Z'),
  },

  // 1 pending USDT on Optimism
  {
    ownerAccountIdx: 4,
    referenceId: '0x111222333444555666777888999aaabbbcccdddeee',
    amount: 1800,
    currency: 'USD',
    status: 'pending',
    direction: 'inbound',
    purpose: 'settlement',
    description: 'USDT bridge deposit pending - Optimism',
    sourceLabel: 'Bridge Protocol',
    destinationLabel: '0x4200...0006',
    fee: 0.50,
    netAmount: 1799.50,
    exchangeRate: null,
    settledAt: null,
    createdAt: new Date('2025-05-24T20:00:00Z'),
  },

  // 1 completed ETH on Base
  {
    ownerAccountIdx: 5,
    referenceId: '0xaaabbbcccdddeeefffaaabbbcccdddeeefffaaabbbcccdddeeefffaabbc123',
    amount: 0.85,
    currency: 'ETH',
    status: 'completed',
    direction: 'inbound',
    purpose: 'settlement',
    description: 'ETH settlement - Base L2',
    sourceLabel: 'DeFi Yield',
    destinationLabel: '0x8335...2913',
    fee: 0.0003,
    netAmount: 0.8497,
    exchangeRate: 2650.0,
    settledAt: new Date('2025-05-18T22:10:00Z'),
    createdAt: new Date('2025-05-18T22:00:00Z'),
  },
]

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
