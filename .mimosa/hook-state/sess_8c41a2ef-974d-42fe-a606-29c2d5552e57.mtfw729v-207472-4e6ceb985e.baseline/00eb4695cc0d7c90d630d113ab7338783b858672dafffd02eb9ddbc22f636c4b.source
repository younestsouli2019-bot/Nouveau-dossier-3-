import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireOpsAuth } from '@/lib/api-auth'
import { verifyTrackingPayload } from '@/lib/procurement/tracking-fraud-guard'
import { carrierProbe } from '@/lib/procurement/carrier-router'

// ══════════════════════════════════════════════════════════════════════════
// MANUAL REVIEW QUEUE (operational fallback, 2026-08-30)
//
// Keyless scraping breaks during peaks (Ramadan / Black Friday) and premium
// keys are optional. Previously a failed scrape left the shipment as a bare
// `trackingVerified=false` with the verdict buried in the notes string. Now:
//   • verify routes persist every verdict to Shipment.lastFraudVerdict(+At)
//   • GET  /api/shipments/review-queue lists everything needing a human:
//       – TRIGGER_MANUAL_REVIEW_HOLD:* (scrape failed / data incomplete)
//       – FLAG_FRAUD:* (destination / weight / timeline)
//   • POST /api/shipments/review-queue re-attempts verification for one
//     shipment (the operator's "retry after carrier recovered" button) or
//     resolves it with an explicit human override.
// Read (GET) is ops-gated but same-origin friendly; mutations (POST) use the
// standard ops auth. Nothing here can ever set trackingVerified=true without
// a real carrier delivered event + VERIFIED_OK — the override only CLEARS a
// fraud hold into a documented human-review outcome, never fabricates proof.
// ══════════════════════════════════════════════════════════════════════════

export async function GET(request: NextRequest) {
  const denied = requireOpsAuth(request)
  if (denied) return denied

  try {
    const holds = await db.shipment.findMany({
      where: {
        trackingVerified: false,
        trackingNumber: { not: null },
        lastFraudVerdict: { not: null },
        OR: [
          { lastFraudVerdict: { startsWith: 'TRIGGER_MANUAL_REVIEW_HOLD' } },
          { lastFraudVerdict: { startsWith: 'FLAG_FRAUD' } },
          { lastFraudVerdict: { startsWith: 'guard_error' } },
          { lastFraudVerdict: { startsWith: 'carrier_no_data' } },
        ],
      },
      orderBy: { lastFraudVerdictAt: 'desc' },
      select: {
        id: true,
        shipmentNumber: true,
        trackingNumber: true,
        carrier: true,
        lastFraudVerdict: true,
        lastFraudVerdictAt: true,
        destinationCity: true,
        updatedAt: true,
      },
    })

    const unscanned = await db.shipment.findMany({
      where: {
        trackingVerified: false,
        trackingNumber: { not: null },
        OR: [{ lastFraudVerdict: null }],
      },
      orderBy: { updatedAt: 'asc' },
      select: {
        id: true,
        shipmentNumber: true,
        trackingNumber: true,
        carrier: true,
        lastFraudVerdict: true,
        lastFraudVerdictAt: true,
        destinationCity: true,
        updatedAt: true,
      },
    })

    return NextResponse.json({
      success: true,
      summary: {
        fraudFlags: holds.filter((h) => h.lastFraudVerdict?.startsWith('FLAG_FRAUD')).length,
        manualHolds: holds.filter((h) => h.lastFraudVerdict?.startsWith('TRIGGER_MANUAL_REVIEW_HOLD')).length,
        scrapeErrors: holds.filter((h) => h.lastFraudVerdict === 'guard_error' || h.lastFraudVerdict === 'carrier_no_data').length,
        neverScanned: unscanned.length,
      },
      queue: [...holds, ...unscanned],
    })
  } catch (error) {
    console.error('[GET /api/shipments/review-queue] Error:', error)
    return NextResponse.json({ success: false, error: 'Failed to load review queue' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const denied = requireOpsAuth(request)
  if (denied) return denied

  try {
    const { shipmentId, action, reviewNote } = await request.json()
    if (!shipmentId) {
      return NextResponse.json({ success: false, error: 'shipmentId required' }, { status: 400 })
    }
    const shipment = await db.shipment.findUnique({ where: { id: shipmentId } })
    if (!shipment) {
      return NextResponse.json({ success: false, error: 'Shipment not found' }, { status: 404 })
    }

    if (action === 'retry') {
      const { trackShipment } = await import('@/lib/carrier-tracking')
      const result = await trackShipment(shipment.trackingNumber!, carrierProbe(shipment.trackingNumber!)?.carrier)
      if (!result) {
        await db.shipment.update({
          where: { id: shipmentId },
          data: {
            lastFraudVerdict: 'TRIGGER_MANUAL_REVIEW_HOLD:retry_no_data',
            lastFraudVerdictAt: new Date(),
          },
        })
        return NextResponse.json({ success: true, retried: false, verdict: 'carrier_no_data' })
      }

      const events = (result.events ?? []) as Array<{ timestamp?: string; location?: string }>
      const sorted = events
        .filter((e) => e && typeof e === 'object')
        .sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime())
      const item = shipment.procurementItemId
        ? await db.procurementItem.findUnique({
            where: { id: shipment.procurementItemId },
            select: { deliveryCity: true, expectedMinWeightKg: true, createdAt: true },
          })
        : null
      const verdict = verifyTrackingPayload({
        scraped: {
          destinationCity: sorted[sorted.length - 1]?.location ?? null,
          weightKg: shipment.weightKg ?? null,
          shippedAt: sorted[0]?.timestamp ?? null,
        },
        order: {
          deliveryCity: item?.deliveryCity ?? null,
          expectedMinWeightKg: item?.expectedMinWeightKg ?? null,
          orderCreatedAt: item?.createdAt ?? null,
        },
      })
      const verified = result.status === 'delivered' && verdict.verdict === 'VERIFIED_OK'
      await db.shipment.update({
        where: { id: shipmentId },
        data: {
          status: result.status,
          trackingVerified: verified,
          trackingVerifiedAt: verified ? new Date() : null,
          events: JSON.stringify(result.events),
          lastFraudVerdict: verdict.verdict,
          lastFraudVerdictAt: new Date(),
        },
      })
      return NextResponse.json({ success: true, retried: true, verdict: verdict.verdict, verified })
    }

    if (action === 'resolve') {
      // Human review outcome. The override can only CLOSE the review item — it
      // never sets trackingVerified=true (only a real carrier event can) and
      // never touches settlement gates.
      const note = (reviewNote || '').trim()
      if (note.length < 10) {
        return NextResponse.json(
          { success: false, error: 'resolve requires a reviewNote (>= 10 chars) documenting the human decision' },
          { status: 400 },
        )
      }
      await db.shipment.update({
        where: { id: shipmentId },
        data: {
          lastFraudVerdict: `MANUAL_REVIEW_RESOLVED:${note.slice(0, 180)}`,
          lastFraudVerdictAt: new Date(),
          notes: `${shipment.notes || ''} | [manual-review resolved] ${note}`.slice(0, 4000),
        },
      })
      return NextResponse.json({ success: true, resolved: true })
    }

    return NextResponse.json({ success: false, error: 'action must be "retry" or "resolve"' }, { status: 400 })
  } catch (error) {
    console.error('[POST /api/shipments/review-queue] Error:', error)
    return NextResponse.json({ success: false, error: 'Review-queue operation failed' }, { status: 500 })
  }
}
