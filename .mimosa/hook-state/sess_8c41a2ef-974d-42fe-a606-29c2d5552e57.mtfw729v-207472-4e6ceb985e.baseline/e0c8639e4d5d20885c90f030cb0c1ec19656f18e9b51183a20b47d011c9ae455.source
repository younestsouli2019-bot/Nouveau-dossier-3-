import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { reason } = body

    if (!reason) {
      return NextResponse.json(
        { success: false, error: 'reason is required' },
        { status: 400 }
      )
    }

    const purchaseOrder = await db.purchaseOrder.findUnique({ where: { id } })
    if (!purchaseOrder) {
      return NextResponse.json(
        { success: false, error: 'Purchase order not found' },
        { status: 404 }
      )
    }

    if (!['pending_approval', 'submitted'].includes(purchaseOrder.status)) {
      return NextResponse.json(
        { success: false, error: `Cannot reject PO in status '${purchaseOrder.status}'` },
        { status: 400 }
      )
    }

    const fromStatus = purchaseOrder.status

    const [updated] = await db.$transaction([
      db.purchaseOrder.update({
        where: { id },
        data: {
          status: 'rejected',
          rejectedBy: 'user',
          rejectedAt: new Date(),
          rejectionReason: reason,
        },
      }),
      db.pOApproval.create({
        data: {
          purchaseOrderId: id,
          action: 'rejected',
          performedBy: 'user',
          reason,
          fromStatus,
          toStatus: 'rejected',
        },
      }),
    ])

    return NextResponse.json({ success: true, data: updated })
  } catch (error) {
    console.error('Error rejecting purchase order:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to reject purchase order' },
      { status: 500 }
    )
  }
}
