import { NextRequest, NextResponse } from 'next/server'
import { strictMarkAsSettled, strictBulkSettle } from '@/lib/strict-enforcement'
import type { SettlementStatus } from '@/lib/strict-enforcement'

export const dynamic = 'force-dynamic'

/**
 * POST /api/settle/strict — Single strict settlement
 * Body: { settlementId, newStatus, externalRef, proofType, proofHash, dataSource, connectorId, connectorStatus, performedBy, reason }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      settlementId?: string
      newStatus?: SettlementStatus
      externalRef?: string | null
      proofType?: string | null
      proofHash?: string | null
      dataSource?: string
      connectorId?: string
      connectorStatus?: string
      performedBy?: string
      reason?: string
      // Bulk mode
      items?: Array<{
        settlementId: string
        newStatus: SettlementStatus
        externalRef?: string | null
        proofType?: string | null
        dataSource?: string
        connectorId?: string
      }>
    }

    // Bulk mode
    if (body.items?.length) {
      const result = await strictBulkSettle(body.items, body.performedBy)
      return NextResponse.json({ success: result.allSuccess, ...result })
    }

    // Single mode
    if (!body.settlementId || !body.newStatus) {
      return NextResponse.json({ success: false, error: 'settlementId and newStatus are required' }, { status: 400 })
    }

    const result = await strictMarkAsSettled({
      settlementId: body.settlementId,
      newStatus: body.newStatus,
      externalRef: body.externalRef ?? null,
      proofType: body.proofType ?? null,
      proofHash: body.proofHash ?? null,
      dataSource: body.dataSource,
      connectorId: body.connectorId,
      connectorStatus: body.connectorStatus,
      performedBy: body.performedBy,
      reason: body.reason,
    })

    return NextResponse.json(result, { status: result.success ? 200 : 422 })
  } catch (error) {
    console.error('[Settle/Strict]', error)
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 })
  }
}
