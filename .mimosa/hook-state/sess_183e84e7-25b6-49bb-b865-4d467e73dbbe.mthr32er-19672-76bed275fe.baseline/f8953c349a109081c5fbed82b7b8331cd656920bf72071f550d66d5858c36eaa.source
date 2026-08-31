import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

const SALARY_RIB = '007810000448500030594182'
const DEBTS_RIB = '007810000448200061321372'

// POST /api/owner-payments/fix-all-routing
// Fixes ALL stuck payments by correcting their routing to external bank
export async function POST() {
  try {
    // Fix all configs that are not yet routing-fixed
    const configs = await db.ownerPaymentConfig.findMany({
      where: { routingFixed: false },
    })

    const configUpdates: { label: string; fixed: boolean }[] = []
    for (const config of configs) {
      const ribNumber = config.label === 'Debts' ? DEBTS_RIB : SALARY_RIB
      const bankName = config.label === 'Debts'
        ? 'Attijariwafa Compte sur Carnet'
        : 'Attijariwafa Bank'

      await db.ownerPaymentConfig.update({
        where: { id: config.id },
        data: {
          routingFixed: true,
          routingFixedAt: new Date(),
          notes: `Routing fixed at ${new Date().toISOString()}. Corrected to route to ${bankName} RIB ...${ribNumber.slice(-6)}`,
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
      const ribNumber = payment.configLabel === 'Debts' ? DEBTS_RIB : SALARY_RIB
      const bankLabel = payment.configLabel === 'Debts'
        ? 'Attijariwafa Compte sur Carnet'
        : 'Attijariwafa Bank'
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
          destinationLabel: `${bankLabel} - RIB ...${ribNumber.slice(-6)}`,
          ribNumber,
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
          destinationLabel: `Attijariwafa Compte sur Carnet - RIB ...${DEBTS_RIB.slice(-6)}`,
          ribNumber: DEBTS_RIB,
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
