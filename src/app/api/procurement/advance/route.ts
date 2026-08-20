// ——— Pipeline Advancement API ———
// POST /api/procurement/advance
//
// Advance procurement items through the pipeline with oracle proofs.
//
// Body: {
//   itemId?: string,        — advance a single item
//   targetStatus?: string,  — advance all to this status
//   bulk?: boolean,         — advance ALL eligible items to next stage
//   carrier?: string,
//   trackingNumber?: string,
//   trackingUrl?: string,
//   proofHash?: string,
//   confirmedBy?: string,
//   notes?: string
// }
// ——————————————————————————————————————————

import { NextRequest, NextResponse } from 'next/server'
import { advanceItem, bulkAdvance } from '@/lib/procurement'
import type { PipelineStatus } from '@/lib/procurement'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      itemId?: string
      targetStatus?: PipelineStatus
      bulk?: boolean
      carrier?: string
      trackingNumber?: string
      trackingUrl?: string
      proofHash?: string
      confirmedBy?: string
      notes?: string
    }

    // Single item advance
    if (body.itemId && body.targetStatus) {
      const result = await advanceItem(body.itemId, body.targetStatus, {
        carrier: body.carrier,
        trackingNumber: body.trackingNumber,
        trackingUrl: body.trackingUrl,
        proofHash: body.proofHash,
        confirmedBy: body.confirmedBy,
        notes: body.notes,
      })

      return NextResponse.json({
        success: true,
        mode: 'single',
        ...result,
      })
    }

    // Bulk advance all eligible items
    if (body.bulk || (!body.itemId && body.targetStatus)) {
      const result = await bulkAdvance(body.targetStatus)

      return NextResponse.json({
        success: true,
        mode: 'bulk',
        ...result,
      })
    }

    return NextResponse.json({
      success: false,
      error: 'Provide either itemId + targetStatus for single advance, or bulk: true for all items',
    }, { status: 400 })
  } catch (error) {
    console.error('[Pipeline Advance]', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Advance failed' },
      { status: 500 }
    )
  }
}
