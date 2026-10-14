import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { db } from '@/lib/db'
import { requireOpsAuth } from '@/lib/api-auth'

/**
 * POST /api/owner-accounts/seed
 *
 * 🚧 PROTÉGÉ: requireOpsAuth + NODE_ENV !== 'production' guard.
 *    Seeds sont des opérations de maintenance, jamais en production.
 * 🚧 RIB literals supprimés: les comptes bancaires Attijari sont résolus
 *    depuis les variables d'env (OWNER_RIB_SALARY / OWNER_RIB_DEBTS) OU
 *    sont créés avec ribNumber=null (à remplir manuellement via admin panel
 *    ou psql). Zéro RIB en source.
 */
export async function POST(request: NextRequest) {
  const denied = requireOpsAuth(request)
  if (denied) return denied

  // Seed interdit en production
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { success: false, error: 'Seed endpoint disabled in production (NODE_ENV=production).' },
      { status: 403 }
    )
  }

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

    // RIB source: env vars (injectées 120s scope) OU null (admin fills later).
    // Jamais de RIB littéral dans ce fichier.
    const ribSalary = process.env.OWNER_RIB_SALARY || null
    const ribDebts = process.env.OWNER_RIB_DEBTS || null

    const SEED_ACCOUNTS = [
      // === Bank Wire Accounts (2 real — RIB from env only) ===
      {
        label: 'Moroccan Bank — RIB 372',
        accountType: 'bank_wire',
        isActive: true,
        isPrimary: true,
        sortOrder: 1,
        purposes: 'salary,settlements,reconciliation',
        accountHolder: process.env.OWNER_ACCOUNT_HOLDER || 'Owner',
        accountNumber: ribDebts,
        accountNumberLast: ribDebts ? ribDebts.slice(-3) : null,
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
        accountHolder: process.env.OWNER_ACCOUNT_HOLDER || 'Owner',
        accountNumberLast: '646',
        bankName: 'Banking Circle S.A.',
        swiftCode: 'BCIRLULL',
        countryCode: 'LU',
        currency: 'USD',
      },
      {
        label: 'Moroccan Bank — RIB 594182',
        accountType: 'bank_wire',
        isActive: true,
        isPrimary: false,
        sortOrder: 6,
        purposes: 'debt_repayment,wire',
        accountHolder: process.env.OWNER_ACCOUNT_HOLDER || 'Owner',
        accountNumber: ribSalary,
        accountNumberLast: ribSalary ? ribSalary.slice(-3) : null,
        bankName: 'Attijariwafa Bank',
        bankCode: '00781',
        swiftCode: 'BCMAMAMC',
        countryCode: 'MA',
        currency: 'MAD',
      },

      // === Crypto Wallet (1 real — address from env) ===
      {
        label: 'USDC on Arbitrum',
        accountType: 'l2_crypto',
        isActive: true,
        isPrimary: false,
        sortOrder: 3,
        purposes: 'crypto_settlement,settlements',
        network: 'Arbitrum',
        walletAddress: process.env.TRUST_WALLET_ADDRESS || null,
        walletAddressShort: process.env.TRUST_WALLET_ADDRESS ? process.env.TRUST_WALLET_ADDRESS.slice(0, 6) + '...' + process.env.TRUST_WALLET_ADDRESS.slice(-4) : null,
        preferredToken: 'USDC',
        chainId: 42161,
        currency: 'USD',
      },

      // === PayPal (1 real — email from env) ===
      {
        label: 'PayPal Business',
        accountType: 'paypal',
        isActive: true,
        isPrimary: false,
        sortOrder: 2,
        purposes: 'settlements,general',
        paypalEmail: process.env.PAYPAL_OWNER_EMAIL || null,
        paypalType: 'business',
        paypalCountry: 'MA',
        currency: 'USD',
      },

      // === Payoneer (1 real — id from env) ===
      {
        label: 'Payoneer — Supplier Payments',
        accountType: 'payoneer',
        isActive: true,
        isPrimary: false,
        sortOrder: 4,
        purposes: 'vendor_payments',
        payoneerId: process.env.PAYONEER_OWNER_ID || null,
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

    // Create all accounts
    const accounts = []
    for (const acc of SEED_ACCOUNTS) {
      const created = await db.ownerAccount.create({ data: acc as any })
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
      message: `Seeded ${accounts.length} owner accounts and ${settlements.length} settlements (RIB/wallet/emails from env vars only — zero literals in source).`,
      accountsSeeded: accounts.length,
      settlementsSeeded: settlements.length,
      notes: [
        'OWNER_RIB_SALARY / OWNER_RIB_DEBTS from env (or null for admin fill)',
        'TRUST_WALLET_ADDRESS from env',
        'PAYPAL_OWNER_EMAIL / PAYONEER_OWNER_ID from env',
      ],
    })
  } catch (error) {
    console.error('Error seeding owner accounts:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to seed owner accounts' },
      { status: 500 }
    )
  }
}

/** Util: sha256 (réservation future pour fingerprint). Non utilisé ici mais importé pour cohérence. */
function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}
