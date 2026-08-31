import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const carrier = searchParams.get('carrier')
    const destination = searchParams.get('destination')
    const verified = searchParams.get('verified')
    const purpose = searchParams.get('purpose')

    const where: Record<string, unknown> = {}
    if (status) where.status = status
    if (carrier) where.carrier = { contains: carrier }
    if (destination) where.destinationName = { contains: destination }
    if (verified === 'true') where.trackingVerified = true
    if (verified === 'false') where.trackingVerified = false
    if (purpose) where.purpose = purpose

    const shipments = await db.shipment.findMany({ where, orderBy: { createdAt: 'desc' } })
    const allShipments = await db.shipment.findMany()

    const totalShipments = allShipments.length
    const trackingNotVerified = allShipments.filter(s => !s.trackingVerified && s.trackingNumber).length
    const inTransit = allShipments.filter(s => ['picked_up', 'in_transit', 'customs', 'out_for_delivery'].includes(s.status)).length
    const delivered = allShipments.filter(s => s.status === 'delivered').length
    const totalShippingCost = allShipments.reduce((sum, s) => sum + (s.shippingCost || 0), 0)
    const totalInsuranceValue = allShipments.reduce((sum, s) => sum + (s.insuranceValue || 0), 0)

    const byStatus: Record<string, number> = {}
    const byDestination: Record<string, number> = {}
    const byCarrier: Record<string, number> = {}
    const byPurpose: Record<string, number> = {}
    for (const s of allShipments) {
      byStatus[s.status] = (byStatus[s.status] || 0) + 1
      byDestination[s.destinationName] = (byDestination[s.destinationName] || 0) + 1
      if (s.carrier) byCarrier[s.carrier] = (byCarrier[s.carrier] || 0) + 1
      if (s.purpose) byPurpose[s.purpose] = (byPurpose[s.purpose] || 0) + 1
    }

    return NextResponse.json({
      success: true, shipments,
      summary: { totalShipments, trackingNotVerified, inTransit, delivered, totalShippingCost, totalInsuranceValue, byStatus, byDestination, byCarrier, byPurpose },
    })
  } catch (error) {
    console.error('[GET /api/shipments] Error:', error)
    return NextResponse.json({ success: false, error: 'Failed to fetch shipments' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const items = Array.isArray(body) ? body : [body]
    if (items.length === 0) return NextResponse.json({ success: false, error: 'No items' }, { status: 400 })

    const VALID = ['pending', 'label_created', 'picked_up', 'in_transit', 'customs', 'out_for_delivery', 'delivered', 'failed', 'returned']
    const created: unknown[] = []
    for (const item of items) {
      if (!item.itemName) continue
      if (item.status && !VALID.includes(item.status)) continue
      created.push(await db.shipment.create({
        data: {
          shipmentNumber: item.shipmentNumber || `SHP-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`,
          procurementItemId: item.procurementItemId || null,
          itemName: item.itemName,
          quantity: item.quantity || 1,
          carrier: item.carrier || null,
          trackingNumber: item.trackingNumber || null,
          trackingUrl: item.trackingUrl || null,
          trackingVerified: item.trackingVerified || false,
          originCountry: item.originCountry || null,
          originCity: item.originCity || null,
          destinationName: item.destinationName || 'Younes Tsouli',
          destinationAddress: item.destinationAddress || null,
          destinationCountry: item.destinationCountry || 'Morocco',
          destinationCity: item.destinationCity || null,
          purpose: item.purpose || null,
          status: item.status || 'pending',
          estimatedDelivery: item.estimatedDelivery ? new Date(item.estimatedDelivery) : null,
          actualDelivery: item.actualDelivery ? new Date(item.actualDelivery) : null,
          weightKg: item.weightKg || null,
          dimensions: item.dimensions || null,
          shippingCost: item.shippingCost || 0,
          currency: item.currency || 'USD',
          insuranceValue: item.insuranceValue || null,
          customsDutyEst: item.customsDutyEst || null,
          notes: item.notes || null,
          events: item.events || null,
        },
      }))
    }
    return NextResponse.json({ success: true, created })
  } catch (error) {
    console.error('[POST /api/shipments] Error:', error)
    return NextResponse.json({ success: false, error: 'Failed to create shipment(s)' }, { status: 500 })
  }
}
