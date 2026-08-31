/**
 * Universal Carrier Tracking Library
 * Supports: Ship24 (2500+ couriers), 9Tracking (1000+ carriers)
 *
 * Data sources: github.com/zodnlhy/carrier-shipping-tools
 *               github.com/api-evangelist
 *               github.com/affaan-m
 *               github.com/clooney
 */

const SHIP24_API = 'https://api.ship24.com/public/v1'
const NINE_TRACKING_API = 'https://www.9tracking.com/api/v1'

const SHIP24_KEY = process.env.SHIP24_API_KEY || ''
const NINE_TRACKING_KEY = process.env.NINE_TRACKING_KEY || ''

export interface TrackingEvent {
  timestamp: string
  location?: string
  status: string
  description: string
  raw?: Record<string, unknown>
}

export interface TrackingResult {
  carrier: string
  trackingNumber: string
  status: string
  statusDetail?: string
  estimatedDelivery?: string
  events: TrackingEvent[]
  source: 'ship24' | '9tracking'
  lastChecked: string
}

const STATUS_MAP: Record<string, string> = {
  picked_up: 'in_transit',
  info_received: 'pending',
  in_transit: 'in_transit',
  out_for_delivery: 'out_for_delivery',
  delivered: 'delivered',
  exception: 'exception',
  expired: 'failed',
  attempted_delivery: 'exception',
  customs: 'customs',
  held: 'exception',
  undelivered: 'failed',
  returned: 'returned',
  available_for_pickup: 'out_for_delivery',
}

export function normalizeStatus(raw: string): string {
  const lower = raw.toLowerCase().replace(/\s+/g, '_')
  return STATUS_MAP[lower] || lower
}

export async function trackShip24(
  trackingNumber: string,
  carrierCode?: string
): Promise<TrackingResult | null> {
  if (!SHIP24_KEY) return null

  try {
    const endpoint = carrierCode
      ? `${SHIP24_API}/trackers?trackingNumber=${encodeURIComponent(trackingNumber)}&carrierCode=${carrierCode}`
      : `${SHIP24_API}/trackers?trackingNumber=${encodeURIComponent(trackingNumber)}`

    const res = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${SHIP24_KEY}` },
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) {
      console.warn(`[Ship24] HTTP ${res.status}: ${res.statusText}`)
      return null
    }

    const data = await res.json()
    const shipment = data?.data?.trackings?.[0]
    if (!shipment) return null

    const events: TrackingEvent[] = (shipment.events || []).map((e: any) => ({
      timestamp: e.timestamp || e.date,
      location: e.location ? [e.location.city, e.location.country].filter(Boolean).join(', ') : undefined,
      status: e.status || 'unknown',
      description: e.description || e.event || '',
      raw: e,
    }))

    const lastEvent = events[0]

    return {
      carrier: shipment.carrier || carrierCode || 'unknown',
      trackingNumber,
      status: normalizeStatus(lastEvent?.status || shipment.status || 'unknown'),
      statusDetail: lastEvent?.description,
      estimatedDelivery: shipment.estimatedDelivery,
      events,
      source: 'ship24',
      lastChecked: new Date().toISOString(),
    }
  } catch (err: any) {
    console.error(`[Ship24] Track failed for ${trackingNumber}:`, err.message)
    return null
  }
}

export async function track9Tracking(
  trackingNumber: string,
  carrierCode?: string
): Promise<TrackingResult | null> {
  if (!NINE_TRACKING_KEY) return null

  try {
    const body: Record<string, string> = { tracking_number: trackingNumber }
    if (carrierCode) body.carrier_code = carrierCode

    const res = await fetch(`${NINE_TRACKING_API}/track`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NINE_TRACKING_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) {
      console.warn(`[9Tracking] HTTP ${res.status}: ${res.statusText}`)
      return null
    }

    const data = await res.json()
    const track = data?.data
    if (!track) return null

    const events: TrackingEvent[] = (track.tracking_details || []).map((e: any) => ({
      timestamp: e.time || e.timestamp,
      location: e.location,
      status: e.status || e.tracking_status || 'unknown',
      description: e.description || e.message || '',
      raw: e,
    }))

    const lastEvent = events[0]

    return {
      carrier: track.carrier || carrierCode || 'unknown',
      trackingNumber,
      status: normalizeStatus(lastEvent?.status || track.status || 'unknown'),
      statusDetail: lastEvent?.description,
      estimatedDelivery: track.estimated_delivery,
      events,
      source: '9tracking',
      lastChecked: new Date().toISOString(),
    }
  } catch (err: any) {
    console.error(`[9Tracking] Track failed for ${trackingNumber}:`, err.message)
    return null
  }
}

export async function trackShipment(
  trackingNumber: string,
  carrierCode?: string
): Promise<TrackingResult | null> {
  let result = await trackShip24(trackingNumber, carrierCode)
  if (result) return result

  result = await track9Tracking(trackingNumber, carrierCode)
  if (result) return result

  return null
}

export async function trackMultiple(
  shipments: Array<{ trackingNumber: string; carrierCode?: string }>
): Promise<Map<string, TrackingResult | null>> {
  const results = new Map<string, TrackingResult | null>()

  await Promise.allSettled(
    shipments.map(async (s) => {
      const result = await trackShipment(s.trackingNumber, s.carrierCode)
      results.set(s.trackingNumber, result)
    })
  )

  return results
}

export async function healthCheck(): Promise<{
  ship24: boolean
  nineTracking: boolean
}> {
  const checks = await Promise.allSettled([
    fetch(`${SHIP24_API}/trackers?trackingNumber=test`, {
      headers: { Authorization: `Bearer ${SHIP24_KEY}` },
      signal: AbortSignal.timeout(5000),
    }).then(r => r.ok || r.status === 404),
    fetch(`${NINE_TRACKING_API}/track`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${NINE_TRACKING_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tracking_number: 'test' }),
      signal: AbortSignal.timeout(5000),
    }).then(r => r.ok),
  ])

  return {
    ship24: checks[0].status === 'fulfilled' && checks[0].value === true,
    nineTracking: checks[1].status === 'fulfilled' && checks[1].value === true,
  }
}
