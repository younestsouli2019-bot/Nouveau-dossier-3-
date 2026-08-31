import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { trackShipment } from '@/lib/carrier-tracking'
import { carrierProbe } from '@/lib/procurement/carrier-router'
import { verifyTrackingPayload } from '@/lib/procurement/tracking-fraud-guard'
import { requireOpsAuth } from '@/lib/api-auth'

// POST /api/shipments/verify - Verify a single tracking number via REAL external data.
//
// FAIL-CLOSED (2026-08-30): the blind `verified: true` flip is REMOVED — that was a
// fabrication vector (verified without a single real carrier event). trackingVerified=true
// is set ONLY when:
//   • a real carrier source returns delivered, AND
//   • the 3-point PO fraud guard returns VERIFIED_OK (destination/weight/timeline).
// Operators may still record a trackingNumber (label created), but that alone NEVER verifies.
//
// Hardening (2026-08-30 second pass):
//   • MONOTONIC: a transient scrape failure never downgrades an already-verified shipment.
//   • destinationCity = terminal scan (last chronological event), not the first (pickup).
//   • weight = carrier-reported weight from the shipment row (events rarely carry it).
//   • verdict persisted to lastFraudVerdict(+At) → surfaces in /api/shipments/review-queue.
function boundedNote(prev: string | null | undefined, add: string): string {
  const merged = `${prev ? `${prev} | ` : ''}${add}`.trim()
  return merged.length <= 4000 ? merged : `…${merged.slice(merged.length - 4000)}`
}

export async function POST(request: NextRequest) {
  const denied = requireOpsAuth(request)
  if (denied) return denied

  try {
    const { shipmentId, trackingNumber } = await request.json()
    if (!shipmentId) return NextResponse.json({ success: false, error: 'shipmentId required' }, { status: 400 })

    const shipment = await db.shipment.findUnique({ where: { id: shipmentId } })
    if (!shipment) return NextResponse.json({ success: false, error: 'Shipment not found' }, { status: 404 })

    const updateData: Record<string, unknown> = {}
    if (trackingNumber) updateData.trackingNumber = trackingNumber
    const effectiveTn = (trackingNumber as string) || shipment.trackingNumber

    if (effectiveTn) {
      const probe = carrierProbe(effectiveTn)
      const item = shipment.procurementItemId
        ? await db.procurementItem.findUnique({
            where: { id: shipment.procurementItemId },
            select: { deliveryCity: true, expectedMinWeightKg: true, createdAt: true },
          })
        : null

      let gateVerified = false
      let verdictLabel = 'no_external_data'
      try {
        const result = await trackShipment(effectiveTn, probe?.carrier)
        if (result && result.status === 'delivered') {
          const events = (result.events ?? []) as Array<{ timestamp?: string; location?: string }>
          const sorted = events
            .filter((e) => e && typeof e === 'object')
            .sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime())
          const firstEvent = sorted[0]
          const lastEvent = sorted[sorted.length - 1]
          const verdict = verifyTrackingPayload({
            scraped: {
              // Terminal scan (delivery event) — NOT the first pickup scan.
              destinationCity: lastEvent?.location ?? firstEvent?.location ?? null,
              // Carrier-reported weight recorded on the row; events rarely carry weight.
              weightKg: shipment.weightKg ?? null,
              shippedAt: firstEvent?.timestamp ?? lastEvent?.timestamp ?? null,
            },
            order: {
              deliveryCity: item?.deliveryCity ?? null,
              expectedMinWeightKg: item?.expectedMinWeightKg ?? null,
              orderCreatedAt: item?.createdAt ?? null,
            },
          })
          verdictLabel = verdict.verdict
          gateVerified = verdict.verdict === 'VERIFIED_OK'
        } else {
          verdictLabel = result
            ? `status_${result.status}`
            : 'carrier_no_data'
        }
      } catch (_e) {
        verdictLabel = 'guard_error'
      }

      // MONOTONIC: verification is never revoked by a later failed/transient scrape.
      const priorVerified = shipment.trackingVerified === true
      updateData.trackingVerified = priorVerified || gateVerified
      updateData.trackingVerifiedAt = updateData.trackingVerified
        ? (shipment.trackingVerifiedAt ?? new Date())
        : null
      updateData.lastFraudVerdict = priorVerified && !gateVerified ? `${verdictLabel} (kept-verified)` : verdictLabel
      updateData.lastFraudVerdictAt = new Date()
      updateData.notes = boundedNote(
        shipment.notes,
        `[verify fraud-guard:${verdictLabel}] trackingVerified=${updateData.trackingVerified}`,
      )
    }

    const updated = await db.shipment.update({ where: { id: shipmentId }, data: updateData })
    return NextResponse.json({
      success: true,
      shipment: updated,
      note: updated.trackingVerified
        ? 'Verified via real carrier delivered event + 3-point PO fraud guard.'
        : 'FAIL-CLOSED: not verified — no real delivered event passed the fraud guard. Non-VERIFIED_OK outcomes (fraud flags / manual holds) are visible in /api/shipments/review-queue. Blind verification is removed.',
    })
  } catch (error) {
    console.error('[POST /api/shipments/verify] Error:', error)
    return NextResponse.json({ success: false, error: 'Failed to verify shipment' }, { status: 500 })
  }
}
