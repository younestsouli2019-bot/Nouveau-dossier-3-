import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST /api/shipments/verify - Verify tracking number
export async function POST(request: NextRequest) {
  try {
    const { shipmentId, trackingNumber, verified } = await request.json()
    if (!shipmentId) return NextResponse.json({ success: false, error: 'shipmentId required' }, { status: 400 })

    const updateData: Record<string, unknown> = {}
    if (typeof verified === 'boolean') {
      updateData.trackingVerified = verified
      if (verified) updateData.trackingVerifiedAt = new Date()
    }
    if (trackingNumber) updateData.trackingNumber = trackingNumber

    const shipment = await db.shipment.update({ where: { id: shipmentId }, data: updateData })
    return NextResponse.json({ success: true, shipment })
  } catch (error) {
    console.error('[POST /api/shipments/verify] Error:', error)
    return NextResponse.json({ success: false, error: 'Failed to verify shipment' }, { status: 500 })
  }
}
