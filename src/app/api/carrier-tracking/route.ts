import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  trackShipment,
  trackMultiple,
  healthCheck as carrierHealthCheck,
  normalizeStatus,
} from '@/lib/carrier-tracking'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action') || 'list'
    const trackingNumber = searchParams.get('trackingNumber')
    const carrier = searchParams.get('carrier')
    const status = searchParams.get('status')

    if (action === 'health') {
      const health = await carrierHealthCheck()
      return NextResponse.json({ success: true, health })
    }

    if (action === 'track' && trackingNumber) {
      const result = await trackShipment(trackingNumber, carrier || undefined)
      if (!result) {
        return NextResponse.json({
          success: false,
          error: 'No tracking data found or API keys not configured',
          hint: 'Set SHIP24_API_KEY and/or NINE_TRACKING_KEY env vars',
        }, { status: 404 })
      }

      const shipment = await db.shipment.findFirst({ where: { trackingNumber } })
      if (shipment) {
        await db.shipment.update({
          where: { id: shipment.id },
          data: {
            status: normalizeStatus(result.status),
            trackingVerified: true,
            trackingVerifiedAt: new Date(),
            events: JSON.stringify(result.events),
          },
        })
      }

      return NextResponse.json({ success: true, tracking: result })
    }

    if (action === 'bulk') {
      const shipments = await db.shipment.findMany({
        where: {
          trackingNumber: { not: null },
          status: { notIn: ['delivered', 'returned'] },
        },
        select: { id: true, trackingNumber: true, carrier: true },
      })

      const results = await trackMultiple(
        shipments.map((s) => ({
          trackingNumber: s.trackingNumber!,
          carrierCode: s.carrier || undefined,
        }))
      )

      let updated = 0
      for (const [tn, result] of results) {
        if (!result) continue
        const shipment = shipments.find((s) => s.trackingNumber === tn)
        if (!shipment) continue

        await db.shipment.update({
          where: { id: shipment.id },
          data: {
            status: normalizeStatus(result.status),
            trackingVerified: true,
            trackingVerifiedAt: new Date(),
            events: JSON.stringify(result.events),
          },
        })
        updated++
      }

      return NextResponse.json({
        success: true,
        totalTracked: shipments.length,
        updated,
        failed: shipments.length - updated,
      })
    }

    // Default: list shipments with tracking info
    const where: Record<string, unknown> = { trackingNumber: { not: null } }
    if (status) where.status = status

    const shipments = await db.shipment.findMany({ where, orderBy: { updatedAt: 'desc' } })

    const summary = {
      total: shipments.length,
      withTracking: shipments.filter((s) => s.trackingNumber).length,
      verified: shipments.filter((s) => s.trackingVerified).length,
      inTransit: shipments.filter((s) => ['in_transit', 'picked_up', 'customs'].includes(s.status)).length,
      delivered: shipments.filter((s) => s.status === 'delivered').length,
    }

    return NextResponse.json({ success: true, shipments, summary })
  } catch (error) {
    console.error('[GET /api/carrier-tracking] Error:', error)
    return NextResponse.json({ success: false, error: 'Carrier tracking failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { trackingNumber, carrierCode, shipmentId } = body

    if (!trackingNumber) {
      return NextResponse.json({ success: false, error: 'trackingNumber required' }, { status: 400 })
    }

    const result = await trackShipment(trackingNumber, carrierCode)

    if (!result) {
      return NextResponse.json({
        success: false,
        error: 'Tracking unavailable — check API keys (SHIP24_API_KEY, NINE_TRACKING_KEY)',
      }, { status: 404 })
    }

    if (shipmentId) {
      await db.shipment.update({
        where: { id: shipmentId },
        data: {
          status: normalizeStatus(result.status),
          trackingVerified: true,
          trackingVerifiedAt: new Date(),
          events: JSON.stringify(result.events),
        },
      })
    }

    return NextResponse.json({ success: true, tracking: result })
  } catch (error) {
    console.error('[POST /api/carrier-tracking] Error:', error)
    return NextResponse.json({ success: false, error: 'Tracking failed' }, { status: 500 })
  }
}
