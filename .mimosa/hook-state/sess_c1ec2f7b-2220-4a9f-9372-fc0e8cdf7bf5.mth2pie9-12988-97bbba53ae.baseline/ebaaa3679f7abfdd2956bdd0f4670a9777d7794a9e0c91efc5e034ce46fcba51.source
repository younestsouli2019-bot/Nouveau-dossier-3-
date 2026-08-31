import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const purchaseOrder = await db.purchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: {
          select: { id: true, name: true, code: true, country: true, contactEmail: true },
        },
        items: {
          orderBy: { poLineItem: 'asc' },
          select: {
            id: true,
            name: true,
            brand: true,
            reference: true,
            quantity: true,
            unitPriceEst: true,
            totalEst: true,
            currency: true,
            status: true,
            poLineItem: true,
          },
        },
        approvals: {
          orderBy: { createdAt: 'desc' },
        },
      },
    })

    if (!purchaseOrder) {
      return NextResponse.json(
        { success: false, error: 'Purchase order not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, data: purchaseOrder })
  } catch (error) {
    console.error('Error fetching purchase order:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch purchase order' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const existing = await db.purchaseOrder.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Purchase order not found' },
        { status: 404 }
      )
    }

    const { notes, priority, batchRef } = body

    const purchaseOrder = await db.purchaseOrder.update({
      where: { id },
      data: {
        ...(notes !== undefined && { notes }),
        ...(priority !== undefined && { priority }),
        ...(batchRef !== undefined && { batchRef }),
      },
    })

    return NextResponse.json({ success: true, data: purchaseOrder })
  } catch (error) {
    console.error('Error updating purchase order:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to update purchase order' },
      { status: 500 }
    )
  }
}
