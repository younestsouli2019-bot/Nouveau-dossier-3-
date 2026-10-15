import { NextRequest, NextResponse } from 'next/server'
import { approvePurchaseOrderWithBudgetCheck } from '@/lib/strict-enforcement/strict-procurement'
import { requireOpsAuth } from '@/lib/api-auth'

/**
 * POST /api/purchase-orders/[id]/approve
 * Approbation HUMAINE requise.
 * 🚧 PROTÉGÉ: requireOpsAuth en tête.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = requireOpsAuth(request)
  if (denied) return denied

  try {
    const { id } = await params
    const actor = resolveOpsIdentity(request)

    const result = await approvePurchaseOrderWithBudgetCheck(id, actor)
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
      approvedBy: actor,
    })
  } catch (error) {
    console.error('Error approving purchase order (budget-gated):', error)
    return NextResponse.json(
      { success: false, error: (error as Error).message || 'Failed to approve purchase order' },
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
