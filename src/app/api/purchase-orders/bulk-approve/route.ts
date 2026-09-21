import { NextRequest, NextResponse } from 'next/server'
import { approvePurchaseOrderWithBudgetCheck } from '@/lib/strict-enforcement/strict-procurement'

function extractApprover(request: NextRequest): string {
  const h = request.headers.get('x-performed-by') || request.headers.get('x-approver') || request.headers.get('x-ops-secret')
  if (h && h.length > 0) return h.length > 8 ? `${h.slice(0,8)}…${h.slice(-4)}` : h
  return 'bulk-user'
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { poIds } = body as { poIds: string[] }

    if (!poIds || !Array.isArray(poIds) || poIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'poIds array is required' },
        { status: 400 }
      )
    }

    const approver = extractApprover(request)
    const results: Record<string, unknown>[] = []
    let approvedCount = 0
    let skippedOrFailed = 0
    for (const id of poIds) {
      try {
        const r = await approvePurchaseOrderWithBudgetCheck(id, approver)
        if (r.approved) { approvedCount++; results.push({ poId: id, approved: true, code: r.code, receipt: r.receipt }) }
        else { skippedOrFailed++; results.push({ poId: id, approved: false, code: r.code, error: r.error }) }
      } catch (e: any) {
        skippedOrFailed++
        results.push({ poId: id, approved: false, code: 'UNEXPECTED_ERROR', error: e.message || String(e) })
      }
    }

    return NextResponse.json({
      success: true,
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
