import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

const SALARY_RIB = '[REDACTED]'

// POST /api/owner-payments/fix-routing
// Fixes salary routing specifically - marks Salary config as routingFixed,
// creates recovery records for all stuck salary payments
export async function POST() {
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
        notes: `Routing fixed at ${new Date().toISOString()}. Originally misconfigured to route salary funds to Banking Circle/operational pools instead of external bank RIB ${SALARY_RIB}. Now corrected to external_bank destination.`,
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
          destinationLabel: `Attijariwafa Bank - RIB ...${SALARY_RIB.slice(-6)}`,
          ribNumber: SALARY_RIB,
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
