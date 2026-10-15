import { NextRequest, NextResponse } from 'next/server'
import { approvePurchaseOrderWithBudgetCheck } from '@/lib/strict-enforcement/strict-procurement'
import { requireOpsAuth } from '@/lib/api-auth'

/**
 * POST /api/purchase-orders/bulk-approve
 * 🚧 PROTÉGÉ: requireOpsAuth en tête.
 */
export async function POST(request: NextRequest) {
  const denied = requireOpsAuth(request)
  if (denied) return denied

  try {
    const body = await request.json()
    const { poIds } = body as { poIds: string[] }
    const actor = resolveOpsIdentity(request)

    if (!poIds || !Array.isArray(poIds) || poIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'poIds array is required' },
        { status: 400 }
      )
    }

    const results: Record<string, unknown>[] = []
    let approvedCount = 0
    let skippedOrFailed = 0
    for (const id of poIds) {
      try {
        const r = await approvePurchaseOrderWithBudgetCheck(id, actor)
        if (r.approved) { approvedCount++; results.push({ poId: id, approved: true, code: r.code, receipt: r.receipt }) }
        else { skippedOrFailed++; results.push({ poId: id, approved: false, code: r.code, error: r.error }) }
      } catch (e: any) {
        skippedOrFailed++
        results.push({ poId: id, approved: false, code: 'UNEXPECTED_ERROR', error: e.message || String(e) })
      }
    }

    return NextResponse.json({
      success: true,
      approvedBy: actor,
      data: {
        approvedCount,
        skippedCount: skippedOrFailed,
        totalRequested: poIds.length,
        perPo: results,
      },
    })
  } catch (error) {
    console.error('Error bulk approving purchase orders (budget-gated):', error)
    return NextResponse.json(
      { success: false, error: (error as Error).message || 'Failed to bulk approve purchase orders' },
      { status: 500 }
    )
  }
}

function resolveOpsIdentity(request: NextRequest): string {
  const header = request.headers.get('x-ops-identity')
  if (header && header.trim().length >= 3) return header.trim().slice(0, 64)
  const opsSecret = request.headers.get('x-ops-secret')
  if (opsSecret) return 'ops-secret-authenticated'
  return 'same-origin-operator'
}
