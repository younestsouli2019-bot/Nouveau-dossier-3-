import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST /api/shipments/verify-all - Auto-verify all tracking numbers with tracking progress
export async function POST() {
  try {
    const unverified = await db.shipment.findMany({
      where: { trackingNumber: { not: null }, trackingVerified: false },
    })

    if (unverified.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'All tracking numbers already verified',
        verified: 0,
        alreadyVerified: 0,
        total: 0,
      })
    }

    const total = await db.shipment.count({ where: { trackingNumber: { not: null } } })
    const alreadyVerified = total - unverified.length

    // Verify in batches with slight delay simulation
    let verified = 0
    const results: { id: string; shipmentNumber: string; trackingNumber: string }[] = []

    for (const shipment of unverified) {
      // Simulate carrier verification check
      const isValid = Boolean(shipment.trackingNumber && shipment.trackingNumber.length >= 8)

      await db.shipment.update({
        where: { id: shipment.id },
        data: {
          trackingVerified: isValid,
          trackingVerifiedAt: isValid ? new Date() : null,
        },
      })

      if (isValid) {
        verified++
        results.push({
          id: shipment.id,
          shipmentNumber: shipment.shipmentNumber,
          trackingNumber: shipment.trackingNumber!,
        })
      }
    }

    return NextResponse.json({
      success: true,
      message: `${verified} tracking numbers verified, ${unverified.length - verified} invalid, ${alreadyVerified} already verified`,
      verified,
      invalid: unverified.length - verified,
      alreadyVerified,
      total,
      progress: {
        verified: alreadyVerified + verified,
        total,
        percentage: Math.round(((alreadyVerified + verified) / total) * 100),
      },
    })
  } catch (error) {
    console.error('[POST /api/shipments/verify-all] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to verify tracking numbers' },
      { status: 500 }
    )
  }
}
