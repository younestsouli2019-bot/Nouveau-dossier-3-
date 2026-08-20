import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

const STATUS_FLOW: string[] = [
  'pending',
  'label_created',
  'picked_up',
  'in_transit',
  'customs',
  'out_for_delivery',
  'delivered',
]

const EVENT_DESCRIPTIONS: Record<string, string> = {
  label_created: 'Shipping label created',
  picked_up: 'Package picked up by carrier',
  in_transit: 'Package in transit to destination country',
  customs: 'Package arrived at customs - awaiting clearance',
  out_for_delivery: 'Package out for delivery',
  delivered: 'Package delivered - signed by recipient',
}

// POST /api/shipments/advance-progress - Advance all shipments one step forward
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const steps: number = body.steps ?? 1
    const maxSteps = Math.min(steps, 6) // Safety: max 6 steps at once

    // Get all non-delivered, non-failed shipments
    const activeShipments = await db.shipment.findMany({
      where: { status: { notIn: ['delivered', 'failed', 'returned'] } },
      orderBy: { createdAt: 'asc' },
    })

    if (activeShipments.length === 0) {
      const deliveredCount = await db.shipment.count({ where: { status: 'delivered' } })
      const totalCount = await db.shipment.count()
      return NextResponse.json({
        success: true,
        message: deliveredCount === totalCount
          ? `All ${totalCount} shipments already delivered!`
          : 'No active shipments to advance',
        advanced: 0,
        delivered: 0,
        stillActive: 0,
        alreadyDelivered: deliveredCount,
      })
    }

    let advanced = 0
    let newlyDelivered = 0
    const details: { shipmentNumber: string; item: string; from: string; to: string }[] = []

    for (const shipment of activeShipments) {
      let currentIdx = STATUS_FLOW.indexOf(shipment.status)
      if (currentIdx === -1) currentIdx = 0

      const nextIdx = Math.min(currentIdx + maxSteps, STATUS_FLOW.length - 1)
      const newStatus = STATUS_FLOW[nextIdx]

      if (newStatus === shipment.status) continue

      // Parse existing events and append new ones
      let events: { date: string; status: string; location: string; description: string }[] = []
      if (shipment.events) {
        try { events = JSON.parse(shipment.events) } catch { events = [] }
      }

      // Add events for each step advanced
      const lastEventDate = events.length > 0
        ? new Date(events[events.length - 1].date)
        : new Date(shipment.createdAt)

      for (let step = currentIdx + 1; step <= nextIdx; step++) {
        const stepDate = new Date(lastEventDate)
        stepDate.setDate(stepDate.getDate() + (step - currentIdx) * 2) // 2 days per step

        const destCity = shipment.destinationCity || 'Casablanca'
        const originCity = shipment.originCity || 'Shenzhen'
        const originCountry = shipment.originCountry || 'China'
        const cityCode = originCountry === 'China' ? 'CN' : originCountry === 'France' ? 'FR' : originCountry === 'USA' ? 'US' : originCountry === 'Germany' ? 'DE' : originCountry === 'UK' ? 'UK' : 'KR'

        let location = `${originCity}, ${cityCode}`
        if (['customs', 'out_for_delivery', 'delivered'].includes(STATUS_FLOW[step])) {
          location = `${destCity}, MA`
        } else if (STATUS_FLOW[step] === 'in_transit') {
          location = 'In transit'
        }

        events.push({
          date: stepDate.toISOString(),
          status: STATUS_FLOW[step],
          location,
          description: EVENT_DESCRIPTIONS[STATUS_FLOW[step]],
        })
      }

      const now = new Date()
      const actualDelivery = newStatus === 'delivered' ? now : null

      await db.shipment.update({
        where: { id: shipment.id },
        data: {
          status: newStatus,
          events: JSON.stringify(events),
          actualDelivery,
          estimatedDelivery: newStatus === 'delivered' ? now : shipment.estimatedDelivery,
        },
      })

      advanced++
      if (newStatus === 'delivered') newlyDelivered++
      details.push({
        shipmentNumber: shipment.shipmentNumber,
        item: shipment.itemName,
        from: shipment.status,
        to: newStatus,
      })
    }

    // Get updated totals
    const totalShipments = await db.shipment.count()
    const deliveredCount = await db.shipment.count({ where: { status: 'delivered' } })
    const verifiedCount = await db.shipment.count({ where: { trackingVerified: true } })
    const stillActive = await db.shipment.count({ where: { status: { notIn: ['delivered', 'failed', 'returned'] } } })

    return NextResponse.json({
      success: true,
      message: `Advanced ${advanced} shipments: ${newlyDelivered} newly delivered`,
      advanced,
      delivered: newlyDelivered,
      stillActive,
      alreadyDelivered: deliveredCount - newlyDelivered,
      totalShipments,
      progress: {
        verified: verifiedCount,
        delivered: deliveredCount,
        total: totalShipments,
        deliveredPct: Math.round((deliveredCount / totalShipments) * 100),
        verifiedPct: Math.round((verifiedCount / totalShipments) * 100),
      },
      details: details.slice(0, 20), // Return first 20 for display
    })
  } catch (error) {
    console.error('[POST /api/shipments/advance-progress] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to advance shipment progress' },
      { status: 500 }
    )
  }
}
