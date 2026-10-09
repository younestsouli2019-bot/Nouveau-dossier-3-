import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireOpsAuth } from '@/lib/api-auth'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = requireOpsAuth(request)
  if (denied) return denied

  try {
    const { id } = await params
    const actor = resolveOpsIdentity(request)

    const purchaseOrder = await db.purchaseOrder.findUnique({ where: { id } })
    if (!purchaseOrder) {
      return NextResponse.json(
        { success: false, error: 'Purchase order not found' },
        { status: 404 }
      )
    }

    if (!['pending_approval', 'submitted'].includes(purchaseOrder.status)) {
      return NextResponse.json(
        { success: false, error: `Cannot approve PO in status '${purchaseOrder.status}'` },
        { status: 400 }
      )
    }

    const fromStatus = purchaseOrder.status

    const [updated] = await db.$transaction([
      db.purchaseOrder.update({
        where: { id },
        data: {
          status: 'approved',
          // @ts-ignore
          approvedBy: actor,
          approvedAt: new Date(),
        },
      }),
      db.pOApproval.create({
        data: {
          purchaseOrderId: id,
          action: 'approved',
          performedBy: actor,
          fromStatus,
          toStatus: 'approved',
        },
      }),
    ])

    return NextResponse.json({ success: true, data: updated, approvedBy: actor })
  } catch (error) {
    console.error('Error approving purchase order:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to approve purchase order' },
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
