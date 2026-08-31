import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

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

    const approvablePOs = await db.purchaseOrder.findMany({
      where: {
        id: { in: poIds },
        status: 'pending_approval',
      },
    })

    let approvedCount = 0
    const now = new Date()

    for (const po of approvablePOs) {
      await db.$transaction([
        db.purchaseOrder.update({
          where: { id: po.id },
          data: {
            status: 'approved',
            approvedBy: 'user',
            approvedAt: now,
          },
        }),
        db.pOApproval.create({
          data: {
            purchaseOrderId: po.id,
            action: 'approved',
            performedBy: 'user',
            fromStatus: po.status,
            toStatus: 'approved',
          },
        }),
      ])
      approvedCount++
    }

    const skippedCount = poIds.length - approvedCount

    return NextResponse.json({
      success: true,
      data: {
        approvedCount,
        skippedCount,
        totalRequested: poIds.length,
      },
    })
  } catch (error) {
    console.error('Error bulk approving purchase orders:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to bulk approve purchase orders' },
      { status: 500 }
    )
  }
}
