import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { trackShipment } from '@/lib/carrier-tracking'
import { carrierProbe } from '@/lib/procurement/carrier-router'
import { verifyTrackingPayload } from '@/lib/procurement/tracking-fraud-guard'
import { requireOpsAuth } from '@/lib/api-auth'

// POST /api/shipments/verify-all - Auto-verify all tracking numbers via REAL external data.
//
// FAIL-CLOSED (2026-08-30): the old "trackingNumber.length >= 8 => verified" heuristic is
// REMOVED — trackingVerified=true is set ONLY when a real carrier source returns delivered
// AND the 3-point PO fraud guard returns VERIFIED_OK. Zero shipments => zero verifications.
//
// Hardening (2026-08-30 second pass):
//   • CONCURRENCY: sequential scrape loop (N shipments × external HTTP in one serverless
//     request) replaced by bounded-concurrency chunks + one jittered retry per shipment
//     on scrape errors (exponential backoff + jitter for carrier rate limits).
//   • destinationCity = terminal scan (last chronological event), not the first (pickup).
//   • weight = carrier-reported weight from the shipment row.
//   • verdict persisted to lastFraudVerdict(+At); manualReview/hold outcomes are returned
//     here and listed in /api/shipments/review-queue.
function boundedNote(prev: string | null | undefined, add: string): string {
  const merged = `${prev ? `${prev} | ` : ''}${add}`.trim()
  return merged.length <= 4000 ? merged : `…${merged.slice(merged.length - 4000)}`
}

const CHUNK_SIZE = 4 // concurrent scrapes per chunk — gentle on carrier pages
const MAX_RUN = 200 // serverless time budget; re-run for the next page

interface Outcome {
  verified: boolean
  verdict: string
}

async function verifyOne(shipment: { id: string; trackingNumber: string; weightKg: number | null; notes: string | null }): Promise<Outcome> {
  const trackingNumber = shipment.trackingNumber
  const probe = carrierProbe(trackingNumber)
  const item = shipment.id
    ? await (async () => {
        const row = await db.shipment.findUnique({ where: { id: shipment.id }, select: { procurementItemId: true } })
        return row?.procurementItemId
          ? db.procurementItem.findUnique({
              where: { id: row.procurementItemId },
              select: { deliveryCity: true, expectedMinWeightKg: true, createdAt: true },
            })
          : null
      })()
    : null

  let outcome: Outcome = { verified: false, verdict: 'no_external_data' }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await trackShipment(trackingNumber, probe?.carrier)
      if (result && result.status === 'delivered') {
        const events = (result.events ?? []) as Array<{ timestamp?: string; location?: string }>
        const sorted = events
          .filter((e) => e && typeof e === 'object')
          .sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime())
        const firstEvent = sorted[0]
        const lastEvent = sorted[sorted.length - 1]
        const verdict = verifyTrackingPayload({
          scraped: {
            destinationCity: lastEvent?.location ?? firstEvent?.location ?? null,
            weightKg: shipment.weightKg ?? null,
            shippedAt: firstEvent?.timestamp ?? lastEvent?.timestamp ?? null,
          },
          order: {
            deliveryCity: item?.deliveryCity ?? null,
            expectedMinWeightKg: item?.expectedMinWeightKg ?? null,
            orderCreatedAt: item?.createdAt ?? null,
          },
        })
        outcome = { verified: verdict.verdict === 'VERIFIED_OK', verdict: verdict.verdict }
      } else {
        outcome = { verified: false, verdict: result ? `status_${result.status}` : 'carrier_no_data' }
      }
      break // got a definitive answer — no retry needed
    } catch (_e) {
      if (attempt === 0) {
        // exponential backoff + jitter (2^1 s base) before the single retry
        const delayMs = 2 ** 1 * 500 + Math.floor(Math.random() * 500)
        await new Promise((r) => setTimeout(r, delayMs))
        continue
      }
      outcome = { verified: false, verdict: 'guard_error' }
    }
  }

  await db.shipment.update({
    where: { id: shipment.id },
    data: {
      trackingVerified: outcome.verified,
      trackingVerifiedAt: outcome.verified ? new Date() : null,
      lastFraudVerdict: outcome.verdict,
      lastFraudVerdictAt: new Date(),
      notes: boundedNote(shipment.notes, `[verify-all fraud-guard:${outcome.verdict}] trackingVerified=${outcome.verified}`),
    },
  })
  return outcome
}

export async function POST(request: NextRequest) {
  const denied = requireOpsAuth(request)
  if (denied) return denied

  try {
    const { searchParams } = new URL(request.url)
    const unverified = await db.shipment.findMany({
      where: { trackingNumber: { not: null }, trackingVerified: false },
      select: { id: true, shipmentNumber: true, trackingNumber: true, weightKg: true, notes: true },
    })

    if (unverified.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'All tracking numbers verifiable',
        verified: 0,
        alreadyVerified: 0,
        total: 0,
      })
    }

    const total = await db.shipment.count({ where: { trackingNumber: { not: null } } })
    const alreadyVerified = total - unverified.length

    const limit = Math.min(
      Number.parseInt(searchParams.get('limit') || '', 10) || unverified.length,
      MAX_RUN,
    )
    const batch = unverified.slice(0, limit)

    let verified = 0
    let manualReview = 0
    const results: { id: string; shipmentNumber: string; trackingNumber: string }[] = []

    for (let i = 0; i < batch.length; i += CHUNK_SIZE) {
      const chunk = batch.slice(i, i + CHUNK_SIZE)
      const outcomes = await Promise.all(chunk.map((s) => verifyOne(s)))
      outcomes.forEach((o, idx) => {
        if (o.verdict === 'TRIGGER_MANUAL_REVIEW_HOLD') manualReview++
        if (o.verified) {
          verified++
          results.push({ id: chunk[idx].id, shipmentNumber: chunk[idx].shipmentNumber, trackingNumber: chunk[idx].trackingNumber })
        }
      })
    }

    return NextResponse.json({
      success: true,
      message: `${verified} tracking verified via real carrier + fraud guard; ${batch.length - verified} remain unverified (no real delivered event), ${manualReview} need manual review, ${alreadyVerified} already verified`,
      verified,
      invalid: batch.length - verified,
      manualReview,
      alreadyVerified,
      total,
      processedThisRun: batch.length,
      remainingAfterRun: unverified.length - batch.length,
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
