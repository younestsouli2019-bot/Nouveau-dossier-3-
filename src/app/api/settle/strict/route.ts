import { NextRequest, NextResponse } from 'next/server'
import { strictMarkAsSettled, strictBulkSettle, killFabrication } from '@/lib/strict-enforcement'
import type { SettlementStatus } from '@/lib/strict-enforcement'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * POST /api/settle/strict — Single strict settlement
 * Body: { settlementId, newStatus, externalRef, proofType, proofHash, dataSource, connectorId, connectorStatus, performedBy, reason }
 *
 * TRUTH-ENFORCED: Blocks settlement if reconciliation balance delta ≠ 0.
 * Balance delta accounts for failed/reversed settlements to prevent deadlock.
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
      items?: Array<{
        settlementId: string
        newStatus: SettlementStatus
        externalRef?: string | null
        proofType?: string | null
        dataSource?: string
        connectorId?: string
      }>
    }

    // TRUTH-KILL: Block fabrication attempts
    const fabricationCheck = killFabrication(body as Record<string, unknown>)
    if (fabricationCheck) return fabricationCheck

    // TRUTH-BLOCK: Check reconciliation balance before allowing settlement
    // Balance delta = Revenue - Settled - Pending - Failed/Reversed
    // Failed/reversed settlements are subtracted because they never completed
    if (body.newStatus === 'completed' || body.items?.some(i => i.newStatus === 'completed')) {
      const allRevenue = await db.revenueEvent.findMany({ where: { status: { not: 'rejected' } } })
      const allSettlements = await db.ownerSettlement.findMany()
      const totalRevenue = allRevenue.reduce((s, r) => s + r.amount, 0)
      const totalSettled = allSettlements.filter(s => s.status === 'completed').reduce((s, x) => s + x.amount, 0)
      const totalPending = allSettlements.filter(s => s.status === 'pending' || s.status === 'processing').reduce((s, x) => s + x.amount, 0)
      const totalFailedReversed = allSettlements.filter(s => s.status === 'failed' || s.status === 'reversed').reduce((s, x) => s + x.amount, 0)
      const balanceDelta = Math.round((totalRevenue - totalSettled - totalPending - totalFailedReversed) * 100) / 100

      if (balanceDelta !== 0) {
        return NextResponse.json({
          success: false,
          error: 'TRUTH-RECONCILE-BLOCK',
          message: `Settlement BLOCKED: Balance delta is $${balanceDelta}. Revenue ($${totalRevenue}) ≠ Settled ($${totalSettled}) + Pending ($${totalPending}) + Failed/Reversed ($${totalFailedReversed}). Resolve the delta before settling.`,
          balanceDelta,
          totalRevenue,
          totalSettled,
          totalPending,
          totalFailedReversed,
        }, { status: 422 })
      }
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
