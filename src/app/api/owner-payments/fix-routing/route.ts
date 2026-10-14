import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { db } from '@/lib/db'
import { requireOpsAuth } from '@/lib/api-auth'

/**
 * POST /api/owner-payments/fix-routing
 * Fixes salary routing specifically - marks Salary config as routingFixed,
 * creates recovery records for all stuck salary payments.
 *
 * 🚧 PROTÉGÉ: requireOpsAuth (fail-closed 401).
 * 🚧 RIB literal supprimé (P5): résolution depuis DB OwnerAccount label='Salary'
 *    via sha256 fingerprint. Zéro RIB en source.
 */
export async function POST(request: NextRequest) {
  const denied = requireOpsAuth(request)
  if (denied) return denied

  try {
    const salaryConfig = await db.ownerPaymentConfig.findUnique({
      where: { label: 'Salary' },
    })

    if (!salaryConfig) {
      return NextResponse.json(
        { success: false, error: 'Salary config not found' },
        { status: 404 }
      )
    }

    // Résoudre fingerprint SALARY depuis DB OwnerAccount (zéro littéral)
    const salaryFp = await fingerprintOfActiveLabel('Salary')
    const salaryDisplay = salaryFp ? await resolveDisplayRibByFingerprint(salaryFp) : '***'

    if (salaryConfig.routingFixed) {
      // Already fixed, report current state
      const recoveryPayments = await db.ownerPayment.findMany({
        where: {
          configLabel: 'Salary',
          recovered: true,
        },
      })
      return NextResponse.json({
        success: true,
        message: 'Salary routing already fixed',
        config: salaryConfig,
        recoveryPayments: recoveryPayments.length,
      })
    }

    // Find all stuck salary payments
    const stuckPayments = await db.ownerPayment.findMany({
      where: {
        configLabel: 'Salary',
        status: 'stuck_in_transition',
        recovered: false,
      },
    })

    // Mark config as routing fixed
    await db.ownerPaymentConfig.update({
      where: { label: 'Salary' },
      data: {
        routingFixed: true,
        routingFixedAt: new Date(),
        notes: `Routing fixed at ${new Date().toISOString()}. Originally misconfigured to route salary funds to Banking Circle/operational pools instead of external bank (RIB fingerprint resolved from DB OwnerAccount label=Salary). Now corrected to external_bank destination.`,
      },
    })

    // Create recovery records for each stuck payment
    const recoveryResults: {
      originalId: string
      originalAmount: number
      originalDestType: string
      recoveryTxRef: string
    }[] = []

    for (const payment of stuckPayments) {
      const recoveryTxRef = `REC-SALARY-${payment.id.slice(-8).toUpperCase()}`

      await db.ownerPayment.update({
        where: { id: payment.id },
        data: {
          recovered: true,
          recoveredAt: new Date(),
          recoveryAmount: payment.amount,
          recoveryTxRef,
          status: 'processing',
          destinationType: 'external_bank',
          destinationLabel: `Attijariwafa Bank - RIB ${salaryDisplay}`,
          // @ts-ignore
          ribFingerprintSha256: salaryFp,
          ribDisplayMasked: salaryDisplay,
          failureReason: null,
        },
      })

      recoveryResults.push({
        originalId: payment.id,
        originalAmount: payment.amount,
        originalDestType: payment.destinationType,
        recoveryTxRef,
      })
    }

    const totalRecovered = stuckPayments.reduce((s, p) => s + p.amount, 0)

    return NextResponse.json({
      success: true,
      message: `Salary routing fixed. ${stuckPayments.length} payments recovered ($${totalRecovered.toFixed(2)})`,
      configUpdated: {
        label: 'Salary',
        routingFixed: true,
        routingFixedAt: new Date().toISOString(),
      },
      paymentsRecovered: recoveryResults.length,
      totalRecoveredAmount: totalRecovered,
      recoveryDetails: recoveryResults,
    })
  } catch (error) {
    console.error('[POST /api/owner-payments/fix-routing] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fix salary routing' },
      { status: 500 }
    )
  }
}

/** sha256(rib) fingerprint depuis DB OwnerAccount (label). Runtime only, zero littéral. */
async function fingerprintOfActiveLabel(label: string): Promise<string | null> {
  const rows = await db.ownerAccount.findMany({
    where: { isActive: true, label },
    select: { accountNumber: true },
  })
  for (const r of rows) {
    if (!r.accountNumber) continue
    return createHash('sha256').update(String(r.accountNumber).trim().toLowerCase()).digest('hex')
  }
  return null
}

/** Résout fingerprint → affichage ***last6 (jamais rib full retourné). */
async function resolveDisplayRibByFingerprint(fp: string): Promise<string | null> {
  if (!fp || fp.length !== 64) return null
  const accounts = await db.ownerAccount.findMany({
    where: { isActive: true, NOT: { accountNumber: null } },
    select: { accountNumber: true },
  })
  for (const a of accounts) {
    if (!a.accountNumber) continue
    const hex = createHash('sha256').update(String(a.accountNumber).trim().toLowerCase()).digest('hex')
    if (hex === fp) {
      const s = String(a.accountNumber)
      return s.length >= 6 ? '***' + s.slice(-6) : '***'
    }
  }
  return null
}
