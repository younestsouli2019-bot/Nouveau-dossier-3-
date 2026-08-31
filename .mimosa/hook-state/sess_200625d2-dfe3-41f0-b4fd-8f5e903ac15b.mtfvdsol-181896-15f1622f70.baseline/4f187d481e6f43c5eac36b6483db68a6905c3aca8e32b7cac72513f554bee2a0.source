import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

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
          approvedBy: 'user',
          approvedAt: new Date(),
        },
      }),
      db.pOApproval.create({
        data: {
          purchaseOrderId: id,
          action: 'approved',
          performedBy: 'user',
          fromStatus,
          toStatus: 'approved',
        },
      }),
    ])

    return NextResponse.json({ success: true, data: updated })
  } catch (error) {
    console.error('Error approving purchase order:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to approve purchase order' },
      { status: 500 }
    )
  }
}
