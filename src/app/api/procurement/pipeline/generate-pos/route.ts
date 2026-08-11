import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { scoreProcurementItems, generatePurchaseOrders } from '@/lib/procurement/pipeline'

/**
 * POST /api/procurement/pipeline/generate-pos
 * Body: { itemIds?: string[], autoApproveThreshold?: number }
 * Scores pending/ordered items, groups them by best supplier, and generates
 * PurchaseOrders. POs under autoApproveThreshold (default 500) are auto-approved
 * following the existing PO convention; larger POs go to pending_approval.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const { itemIds, autoApproveThreshold } = body as {
      itemIds?: string[]
      autoApproveThreshold?: number
    }

    const where = itemIds && itemIds.length > 0
      ? { id: { in: itemIds } }
      : { status: { in: ['pending', 'ordered'] } }

    const dbItems = await db.procurementItem.findMany({ where })
    if (dbItems.length === 0) {
      return NextResponse.json({ success: true, purchaseOrders: [], warning: 'No procurement items to generate POs for' })
    }

    const items = dbItems.map((i) => ({
      name: i.name,
      brand: i.brand,
      reference: i.reference,
      category: i.category,
      quantity: i.quantity,
      unitPriceEst: i.unitPriceEst ?? 0,
      currency: i.currency ?? 'USD',
      recipientName: i.recipientName,
      recipientAddress: i.recipientAddress ?? '',
      priority: (i.priority as 'normal' | 'high' | 'urgent') ?? 'normal',
      supplierHint: i.supplierName,
    }))

    const scored = await scoreProcurementItems(items)
    const purchaseOrders = await generatePurchaseOrders(scored, { autoApproveThreshold })

    return NextResponse.json({
      success: true,
      purchaseOrders,
      poCount: purchaseOrders.length,
      autoApprovedUnder: autoApproveThreshold ?? 500,
    })
  } catch (error) {
    console.error('Error generating purchase orders:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to generate purchase orders' },
      { status: 500 },
    )
  }
}
