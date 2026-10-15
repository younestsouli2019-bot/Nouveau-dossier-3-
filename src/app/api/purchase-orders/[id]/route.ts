import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireOpsAuth } from '@/lib/api-auth'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = requireOpsAuth(request)
  if (denied) return denied

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
  const denied = requireOpsAuth(request)
  if (denied) return denied

  try {
    const { id } = await params
    const actor = resolveOpsIdentity(request)
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

    return NextResponse.json({ success: true, data: purchaseOrder, updatedBy: actor })
  } catch (error) {
    console.error('Error updating purchase order:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to update purchase order' },
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
