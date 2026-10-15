import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { db } from '@/lib/db'
import { requireOpsAuth } from '@/lib/api-auth'

/**
 * POST /api/owner-payments/fix-all-routing
 * Fixes ALL stuck payments by correcting their routing to external bank.
 *
 * 🚧 PROTÉGÉ: requireOpsAuth (fail-closed 401).
 * 🚧 RIB literals supprimés (P5): résolution fingerprints depuis DB OwnerAccount
 *    par label (Salary/Debts). Zéro RIB en source.
 */
export async function POST(request: NextRequest) {
  const denied = requireOpsAuth(request)
  if (denied) return denied

  try {
    // Résoudre fingerprints depuis DB (zéro littéral)
    const salaryFp = await fingerprintOfActiveLabel('Salary')
    const debtsFp = await fingerprintOfActiveLabel('Debts')
    const salaryDisplay = salaryFp ? await resolveDisplayRibByFingerprint(salaryFp) : '***'
    const debtsDisplay = debtsFp ? await resolveDisplayRibByFingerprint(debtsFp) : '***'

    // Fix all configs that are not yet routing-fixed
    const configs = await db.ownerPaymentConfig.findMany({
      where: { routingFixed: false },
    })

    const configUpdates: { label: string; fixed: boolean }[] = []
    for (const config of configs) {
      const isDebts = config.label === 'Debts'
      const bankName = isDebts ? 'Attijariwafa Compte sur Carnet' : 'Attijariwafa Bank'
      const display = isDebts ? debtsDisplay : salaryDisplay

      await db.ownerPaymentConfig.update({
        where: { id: config.id },
        data: {
          routingFixed: true,
          routingFixedAt: new Date(),
          notes: `Routing fixed at ${new Date().toISOString()}. Corrected to route to ${bankName} RIB ${display} (fingerprint resolved from DB OwnerAccount).`,
        },
      })
      configUpdates.push({ label: config.label, fixed: true })
    }

    // Find ALL stuck payments
    const stuckPayments = await db.ownerPayment.findMany({
      where: {
        status: 'stuck_in_transition',
        recovered: false,
      },
    })

    const recoveryResults: {
      id: string
      configLabel: string
      amount: number
      fromDestType: string
      toDestType: string
      recoveryTxRef: string
    }[] = []

    let totalRecovered = 0

    for (const payment of stuckPayments) {
      const isDebts = payment.configLabel === 'Debts'
      const bankLabel = isDebts ? 'Attijariwafa Compte sur Carnet' : 'Attijariwafa Bank'
      const fp = isDebts ? debtsFp : salaryFp
      const display = isDebts ? debtsDisplay : salaryDisplay
      const recoveryTxRef = `REC-${payment.configLabel.replace(/\s+/g, '_').toUpperCase()}-${payment.id.slice(-8).toUpperCase()}`

      await db.ownerPayment.update({
        where: { id: payment.id },
        data: {
          recovered: true,
          recoveredAt: new Date(),
          recoveryAmount: payment.amount,
          recoveryTxRef,
          status: 'processing',
          destinationType: 'external_bank',
          destinationLabel: `${bankLabel} - RIB ${display}`,
          // @ts-ignore
          ribFingerprintSha256: fp,
          ribDisplayMasked: display,
          failureReason: null,
        },
      })

      recoveryResults.push({
        id: payment.id,
        configLabel: payment.configLabel,
        amount: payment.amount,
        fromDestType: payment.destinationType,
        toDestType: 'external_bank',
        recoveryTxRef,
      })
      totalRecovered += payment.amount
    }

    // Check for MT103 stuck in banking_circle (from supply-chain seed)
    const mt103Stuck = await db.ownerPayment.findMany({
      where: {
        status: 'stuck_in_transition',
        destinationType: 'banking_circle',
        recovered: false,
      },
    })

    for (const payment of mt103Stuck) {
      const recoveryTxRef = `REC-MT103-${payment.id.slice(-8).toUpperCase()}`
      await db.ownerPayment.update({
        where: { id: payment.id },
        data: {
          recovered: true,
          recoveredAt: new Date(),
          recoveryAmount: payment.amount,
          recoveryTxRef,
          status: 'processing',
          destinationType: 'external_bank',
          destinationLabel: `Attijariwafa Compte sur Carnet - RIB ${debtsDisplay}`,
          // @ts-ignore
          ribFingerprintSha256: debtsFp,
          ribDisplayMasked: debtsDisplay,
          failureReason: null,
        },
      })

      recoveryResults.push({
        id: payment.id,
        configLabel: payment.configLabel,
        amount: payment.amount,
        fromDestType: 'banking_circle',
        toDestType: 'external_bank',
        recoveryTxRef,
      })
      totalRecovered += payment.amount
    }

    return NextResponse.json({
      success: true,
      message: `All routing fixed. ${configs.length} configs updated, ${recoveryResults.length} payments recovered ($${totalRecovered.toFixed(2)})`,
      configsUpdated: configUpdates,
      paymentsRecovered: recoveryResults.length,
      totalRecoveredAmount: totalRecovered,
      recoveryDetails: recoveryResults,
    })
  } catch (error) {
    console.error('[POST /api/owner-payments/fix-all-routing] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fix all routing' },
      { status: 500 }
    )
  }
}

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
