import { NextRequest, NextResponse } from 'next/server'
import { strictIngestRevenue, killFabrication } from '@/lib/strict-enforcement'
import type { RevenueEventInput } from '@/lib/strict-enforcement'

export const dynamic = 'force-dynamic'

/**
 * POST /api/revenue/strict — Ingest revenue with proof enforcement
 * Body: { events: [...], batchReference?, allowUnverified?, performedBy? }
 *
 * TRUTH-ENFORCED: Fabrication kill-switch active
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      events: RevenueEventInput[]
      batchReference?: string
      allowUnverified?: boolean
      performedBy?: string
    }

    // TRUTH-KILL: Block fabrication attempts
    const fabricationCheck = killFabrication(body as Record<string, unknown>)
    if (fabricationCheck) return fabricationCheck

    if (!body.events?.length) {
      return NextResponse.json({ success: false, error: 'events array is required' }, { status: 400 })
    }

    const result = await strictIngestRevenue({
      events: body.events,
      batchReference: body.batchReference,
      allowUnverified: body.allowUnverified ?? false,
      performedBy: body.performedBy,
    })

    return NextResponse.json(result, { status: result.success ? 201 : 422 })
  } catch (error) {
    console.error('[Revenue/Strict]', error)
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 })
  }
}
