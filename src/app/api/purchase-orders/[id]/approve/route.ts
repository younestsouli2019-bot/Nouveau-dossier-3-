import { NextRequest, NextResponse } from 'next/server'
import { approvePurchaseOrderWithBudgetCheck } from '@/lib/strict-enforcement/strict-procurement'

function extractApprover(request: NextRequest): string {
  const h = request.headers.get('x-performed-by') || request.headers.get('x-approver') || request.headers.get('x-ops-secret')
  if (h && h.length > 0) return h.length > 8 ? `${h.slice(0,8)}…${h.slice(-4)}` : h
  return 'user'
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const approver = extractApprover(request)

    const result = await approvePurchaseOrderWithBudgetCheck(id, approver)
    if (!result.approved) {
      return NextResponse.json(
        {
          success: false,
          approved: false,
          code: result.code || 'APPROVAL_FAILED',
          error: result.error || `Budget check failed: ${result.code}`,
        },
        { status: (result.code === 'PO_NOT_FOUND') ? 404 : 400 }
      )
    }

    return NextResponse.json({
      success: true,
      approved: true,
      data: result.receipt,
    })
  } catch (error) {
    console.error('Error approving purchase order (budget-gated):', error)
    return NextResponse.json(
      { success: false, error: (error as Error).message || 'Failed to approve purchase order' },
      { status: 500 }
    )
  }
}
