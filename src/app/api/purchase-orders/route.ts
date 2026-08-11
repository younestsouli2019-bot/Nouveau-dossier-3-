import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const supplierId = searchParams.get('supplierId')
    const priority = searchParams.get('priority')

    const where: Record<string, unknown> = {}
    if (status) where.status = status
    if (supplierId) where.supplierId = supplierId
    if (priority) where.priority = priority

    const purchaseOrders = await db.purchaseOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        supplier: {
          select: { id: true, name: true, code: true },
        },
        items: {
          select: { id: true, name: true, quantity: true, unitPriceEst: true, totalEst: true },
        },
      },
    })

    const enriched = purchaseOrders.map((po) => ({
      ...po,
      supplierNameDisplay: po.supplier?.name || po.supplierName,
      supplierCode: po.supplier?.code || null,
    }))

    // Summary
    const allPOs = await db.purchaseOrder.findMany({
      select: { status: true, totalAmount: true },
    })

    const byStatus: Record<string, number> = {}
    let totalValue = 0
    let pendingApprovalCount = 0

    for (const po of allPOs) {
      byStatus[po.status] = (byStatus[po.status] || 0) + 1
      totalValue += po.totalAmount || 0
      if (po.status === 'pending_approval') pendingApprovalCount++
    }

    const summary = {
      totalPOs: allPOs.length,
      byStatus,
      pendingApprovalCount,
      totalValue,
    }

    return NextResponse.json({ success: true, orders: enriched, summary })
  } catch (error) {
    console.error('Error listing purchase orders:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to list purchase orders' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { poNumber, supplierName, supplierId, title, priority, notes, batchRef, itemIds } = body

    if (!poNumber || !supplierName) {
      return NextResponse.json(
        { success: false, error: 'poNumber and supplierName are required' },
        { status: 400 }
      )
    }

    // Check unique PO number
    const existing = await db.purchaseOrder.findUnique({ where: { poNumber } })
    if (existing) {
      return NextResponse.json(
        { success: false, error: 'Purchase order with this number already exists' },
        { status: 409 }
      )
    }

    // Calculate line items and total from attached items
    let lineItemCount = 0
    let totalAmount = 0
    if (itemIds && itemIds.length > 0) {
      const items = await db.procurementItem.findMany({
        where: { id: { in: itemIds } },
      })
      lineItemCount = items.length
      totalAmount = items.reduce((sum, item) => sum + (item.totalEst || 0), 0)
    }

    const purchaseOrder = await db.purchaseOrder.create({
      data: {
        poNumber,
        supplierName,
        supplierId: supplierId || null,
        title: title || null,
        priority: priority || 'normal',
        notes: notes || null,
        batchRef: batchRef || null,
        lineItemCount,
        totalAmount: Math.round(totalAmount * 100) / 100,
        status: 'draft',
      },
    })

    // Attach items to the PO
    if (itemIds && itemIds.length > 0) {
      for (let i = 0; i < itemIds.length; i++) {
        await db.procurementItem.update({
          where: { id: itemIds[i] },
          data: {
            purchaseOrderId: purchaseOrder.id,
            poLineItem: i + 1,
            supplierId: supplierId || undefined,
          },
        })
      }
    }

    return NextResponse.json({ success: true, data: purchaseOrder }, { status: 201 })
  } catch (error) {
    console.error('Error creating purchase order:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to create purchase order' },
      { status: 500 }
    )
  }
}
