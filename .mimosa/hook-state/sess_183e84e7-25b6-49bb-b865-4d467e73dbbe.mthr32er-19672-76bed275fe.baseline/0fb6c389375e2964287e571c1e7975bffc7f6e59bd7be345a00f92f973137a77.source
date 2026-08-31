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

    if (purchaseOrder.status !== 'draft') {
      return NextResponse.json(
        { success: false, error: `Cannot submit PO in status '${purchaseOrder.status}'` },
        { status: 400 }
      )
    }

    const now = new Date()

    // Auto-approve POs under $500
    if (purchaseOrder.totalAmount < 500) {
      const [updated] = await db.$transaction([
        db.purchaseOrder.update({
          where: { id },
          data: {
            status: 'approved',
            submittedAt: now,
            approvedBy: 'auto',
            approvedAt: now,
          },
        }),
        db.pOApproval.create({
          data: {
            purchaseOrderId: id,
            action: 'submitted',
            performedBy: 'system',
            fromStatus: 'draft',
            toStatus: 'pending_approval',
          },
        }),
        db.pOApproval.create({
          data: {
            purchaseOrderId: id,
            action: 'approved',
            performedBy: 'auto',
            reason: 'Auto-approved: total under $500',
            fromStatus: 'pending_approval',
            toStatus: 'approved',
          },
        }),
      ])

      return NextResponse.json({ success: true, data: updated, autoApproved: true })
    }

    // Normal submit flow
    const [updated] = await db.$transaction([
      db.purchaseOrder.update({
        where: { id },
        data: {
          status: 'pending_approval',
          submittedAt: now,
        },
      }),
      db.pOApproval.create({
        data: {
          purchaseOrderId: id,
          action: 'submitted',
          performedBy: 'system',
          fromStatus: 'draft',
          toStatus: 'pending_approval',
        },
      }),
    ])

    return NextResponse.json({ success: true, data: updated, autoApproved: false })
  } catch (error) {
    console.error('Error submitting purchase order:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to submit purchase order' },
      { status: 500 }
    )
  }
}
