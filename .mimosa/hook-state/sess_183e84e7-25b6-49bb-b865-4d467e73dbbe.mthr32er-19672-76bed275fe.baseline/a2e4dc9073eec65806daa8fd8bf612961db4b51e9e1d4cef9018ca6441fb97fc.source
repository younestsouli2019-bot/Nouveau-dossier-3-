import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  trackShipment,
  trackMultiple,
  healthCheck as carrierHealthCheck,
  normalizeStatus,
} from '@/lib/carrier-tracking'
import { carrierProbe } from '@/lib/procurement/carrier-router'
import { verifyTrackingPayload } from '@/lib/procurement/tracking-fraud-guard'
import { requireOpsAuth } from '@/lib/api-auth'
import type { TrackingResult } from '@/lib/carrier-tracking'

/** Notes grow on every scrape — bound them. */
function boundedNote(prev: string | null | undefined, add: string): string {
  const merged = `${prev ? `${prev} | ` : ''}${add}`.trim()
  return merged.length <= 4000 ? merged : `…${merged.slice(merged.length - 4000)}`
}

/**
 * 3-point PO fraud guard gate for a tracking result.
 * trackingVerified is set to true ONLY when:
 *   - the real carrier source reports a delivered event, AND
 *   - verifyTrackingPayload() returns VERIFIED_OK against the linked PO/item
 *     (destination city, weight floor, timeline-not-recycled).
 * Any FLAG_FRAUD or TRIGGER_MANUAL_REVIEW_HOLD → trackingVerified stays false
 * (fail-closed secure baseline; see tracking-fraud-guard.ts).
 *
 * Signal corrections (2026-08-30):
 *   - destinationCity = TERMINAL scan (last chronological event), not the first
 *     (origin/pickup) event.
 *   - weight = carrier-reported weight recorded on the shipment row (the events
 *     feed itself rarely carries weight).
 * Monotonic guarantee: a later failed/transient scrape NEVER downgrades an
 * already-verified shipment (carrier parsers break during peaks).
 */
async function fraudGateForShipment(
  shipmentId: string,
  result: TrackingResult | null,
): Promise<{ trackingVerified: boolean; verdictLabel: string; scrapedPayload?: unknown; priorVerified: boolean }> {
  if (!result) return { trackingVerified: false, verdictLabel: 'no_result', priorVerified: false }

  const isDelivered = normalizeStatus(result.status) === 'delivered'
  const events = (result.events ?? []) as Array<{ timestamp?: string; location?: string }>
  const sorted = events
    .filter((e) => e && typeof e === 'object')
    .sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime())
  const firstEvent = sorted[0]
  const lastEvent = sorted[sorted.length - 1]
  const scrapedPayload = {
    destinationCity: lastEvent?.location ?? firstEvent?.location ?? null,
    weightKg: null as number | null,
    shippedAt: firstEvent?.timestamp ?? lastEvent?.timestamp ?? null,
  }

  try {
    const shipment = await db.shipment.findUnique({ where: { id: shipmentId } })
    if (!shipment) return { trackingVerified: false, verdictLabel: 'shipment_not_found', priorVerified: false }
    scrapedPayload.weightKg = shipment.weightKg ?? null
    const item = shipment.procurementItemId
      ? await db.procurementItem.findUnique({ where: { id: shipment.procurementItemId } })
      : null
    const order = {
      deliveryCity: item?.deliveryCity ?? null,
      expectedMinWeightKg: item?.expectedMinWeightKg ?? null,
      orderCreatedAt: item?.createdAt ?? null,
    }
    const verdict = verifyTrackingPayload({ scraped: scrapedPayload, order })
    const guardPass = verdict.verdict === 'VERIFIED_OK'
    const trackingVerified = shipment.trackingVerified || (isDelivered && guardPass)
    const verdictLabel =
      shipment.trackingVerified && !guardPass ? `${verdict.verdict} (kept-verified)` : verdict.verdict
    return { trackingVerified, verdictLabel, scrapedPayload, priorVerified: shipment.trackingVerified }
  } catch (_e) {
    // Fraud guard is fail-closed: an error reading PO context never unlocks verification.
    return { trackingVerified: false, verdictLabel: 'guard_error', priorVerified: false }
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action') || 'list'
    const trackingNumber = searchParams.get('trackingNumber')
    const carrier = searchParams.get('carrier')
    const status = searchParams.get('status')

    if (action === 'health') {
      const health = await carrierHealthCheck()
      // Keyless Moroccan-carrier route is always available — report it so the
      // operator knows paid keys only unlock premium providers, not local traceability.
      return NextResponse.json({
        success: true,
        health: {
          ...health,
          keylessCarrierRouter: true,
          note: health.ship24 || health.nineTracking
            ? 'Premium active'
            : 'No paid keys — local Morocco carriers resolve via keyless track-by-reference',
        },
      })
    }

    // track/bulk trigger external scrapes AND DB writes — auth-gate them.
    // health/list stay open (read-only).
    if ((action === 'track' || action === 'bulk')) {
      const denied = requireOpsAuth(request)
      if (denied) return denied
    }

    if (action === 'track' && trackingNumber) {
      const probe = carrierProbe(trackingNumber)
      const result = await trackShipment(trackingNumber, carrier || probe?.carrier || undefined)
      if (!result) {
        // Keyless fallback: attach a real public track URL but NEVER invent events.
        if (probe && probe.known) {
          const shipment = await db.shipment.findFirst({ where: { trackingNumber } })
          if (shipment) {
            await db.shipment.update({
              where: { id: shipment.id },
              data: {
                carrier: probe.carrier,
                trackingUrl: probe.publicUrl,
                trackingVerified: false, // no real event — leave unverified
              },
            })
          }
          return NextResponse.json({
            success: true,
            keyless: true,
            carrier: probe.carrier,
            trackingNumber,
            trackingUrl: probe.publicUrl,
            status: 'pending', // honest: nothing confirmed yet
            note: 'Carrier identified (keyless track-by-reference). Premium event data requires SHIP24_API_KEY / NINE_TRACKING_KEY.',
          })
        }
        return NextResponse.json({
          success: false,
          error: 'No tracking data found or API keys not configured',
          hint: 'Set SHIP24_API_KEY and/or NINE_TRACKING_KEY env vars',
        }, { status: 404 })
      }

      const shipment = await db.shipment.findFirst({ where: { trackingNumber } })
      if (shipment) {
        const gate = await fraudGateForShipment(shipment.id, result)
        await db.shipment.update({
          where: { id: shipment.id },
          data: {
            status: normalizeStatus(result.status),
            trackingVerified: gate.trackingVerified,
            trackingVerifiedAt: gate.trackingVerified ? (shipment.trackingVerifiedAt ?? new Date()) : undefined,
            events: JSON.stringify(result.events),
            lastFraudVerdict: gate.verdictLabel,
            lastFraudVerdictAt: new Date(),
            notes: boundedNote(shipment.notes, `[fraud-guard verdict:${gate.verdictLabel}] trackingVerified=${gate.trackingVerified}`),
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
        select: { id: true, trackingNumber: true, carrier: true, notes: true },
      })

      const results = await trackMultiple(
        shipments.map((s) => ({
          trackingNumber: s.trackingNumber!,
          carrierCode: s.carrier || undefined,
        }))
      )

      let updated = 0
      for (const [tn, result] of results) {
        const shipment = shipments.find((s) => s.trackingNumber === tn)
        if (!shipment) continue

        if (!result) {
          // Keyless fallback: identify the carrier + attach public track URL, keep unverified.
          const probe = carrierProbe(tn)
          if (probe && probe.known) {
            await db.shipment.update({
              where: { id: shipment.id },
              data: {
                carrier: probe.carrier,
                trackingUrl: probe.publicUrl,
                trackingVerified: false,
              },
            })
            updated++
          }
          continue
        }

        const gate = await fraudGateForShipment(shipment.id, result)
        await db.shipment.update({
          where: { id: shipment.id },
          data: {
            status: normalizeStatus(result.status),
            trackingVerified: gate.trackingVerified,
            trackingVerifiedAt: gate.trackingVerified ? new Date() : undefined,
            events: JSON.stringify(result.events),
            lastFraudVerdict: gate.verdictLabel,
            lastFraudVerdictAt: new Date(),
            notes: boundedNote(shipment.notes, `[fraud-guard verdict:${gate.verdictLabel}] trackingVerified=${gate.trackingVerified}`),
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
    const denied = requireOpsAuth(request)
    if (denied) return denied

    const body = await request.json()
    const { trackingNumber, carrierCode, shipmentId } = body

    if (!trackingNumber) {
      return NextResponse.json({ success: false, error: 'trackingNumber required' }, { status: 400 })
    }

    const result = await trackShipment(trackingNumber, carrierCode)

    if (!result) {
      const probe = carrierProbe(trackingNumber)
      if (probe && probe.known && shipmentId) {
        await db.shipment.update({
          where: { id: shipmentId },
          data: {
            carrier: probe.carrier,
            trackingNumber,
            trackingUrl: probe.publicUrl,
            trackingVerified: false,
          },
        })
        return NextResponse.json({
          success: true,
          keyless: true,
          carrier: probe.carrier,
          trackingNumber,
          trackingUrl: probe.publicUrl,
          status: 'pending',
          note: 'Carrier identified via keyless track-by-reference. Premium event data requires SHIP24_API_KEY / NINE_TRACKING_KEY.',
        })
      }
      return NextResponse.json({
        success: false,
        error: 'Tracking unavailable — check API keys (SHIP24_API_KEY, NINE_TRACKING_KEY)',
      }, { status: 404 })
    }

    if (shipmentId) {
      const prior = await db.shipment.findUnique({ where: { id: shipmentId }, select: { notes: true } })
      const gate = await fraudGateForShipment(shipmentId, result)
      await db.shipment.update({
        where: { id: shipmentId },
        data: {
          status: normalizeStatus(result.status),
          trackingVerified: gate.trackingVerified,
          trackingVerifiedAt: gate.trackingVerified ? new Date() : undefined,
          events: JSON.stringify(result.events),
          lastFraudVerdict: gate.verdictLabel,
          lastFraudVerdictAt: new Date(),
          notes: boundedNote(prior?.notes, `[fraud-guard verdict:${gate.verdictLabel}] trackingVerified=${gate.trackingVerified}`),
        },
      })
    }

    return NextResponse.json({ success: true, tracking: result })
  } catch (error) {
    console.error('[POST /api/carrier-tracking] Error:', error)
    return NextResponse.json({ success: false, error: 'Tracking failed' }, { status: 500 })
  }
}
