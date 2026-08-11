import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST /api/owner-payments/simulate-autosplit
// Given { amount: number }, return auto-split breakdown based on config percentages
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { amount } = body

    if (typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json(
        { success: false, error: 'Valid positive amount is required' },
        { status: 400 }
      )
    }

    const configs = await db.ownerPaymentConfig.findMany({
      where: { isActive: true },
      orderBy: { splitPercentage: 'desc' },
    })

    if (configs.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No active payment configs found' },
        { status: 404 }
      )
    }

    const totalPct = configs.reduce((s, c) => s + c.splitPercentage, 0)
    const breakdown = configs.map((cfg) => {
      const splitAmount = Math.round((amount * cfg.splitPercentage / 100) * 100) / 100
      return {
        label: cfg.label,
        splitPercentage: cfg.splitPercentage,
        amount: splitAmount,
        currency: 'USD',
        destination: {
          type: 'external_bank',
          bankName: cfg.bankName || null,
          ribNumber: cfg.ribNumber ? `...${cfg.ribNumber.slice(-6)}` : null,
          ribFull: cfg.ribNumber || null,
          swiftCode: cfg.swiftCode || null,
          ribLabel: cfg.ribLabel || null,
        },
        routingFixed: cfg.routingFixed,
        notes: cfg.notes || null,
      }
    })

    const allocatedTotal = breakdown.reduce((s, b) => s + b.amount, 0)
    const remainder = Math.round((amount - allocatedTotal) * 100) / 100

    return NextResponse.json({
      success: true,
      inputAmount: amount,
      currency: 'USD',
      totalPctConfigured: totalPct,
      totalAllocated: allocatedTotal,
      remainder,
      remainderNote: remainder > 0
        ? `$${remainder.toFixed(2)} unallocated due to rounding or incomplete percentage coverage`
        : null,
      breakdown,
    })
  } catch (error) {
    console.error('[POST /api/owner-payments/simulate-autosplit] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to simulate auto-split' },
      { status: 500 }
    )
  }
}
