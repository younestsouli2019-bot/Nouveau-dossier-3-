import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/procurement - List all procurement items with optional filters and summary stats
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const category = searchParams.get('category')
    const recipient = searchParams.get('recipient')
    const priority = searchParams.get('priority')

    const where: Record<string, unknown> = {}

    if (status) where.status = status
    if (category) where.category = category
    if (priority) where.priority = priority
    if (recipient) {
      where.recipientName = { contains: recipient }
    }

    const items = await db.procurementItem.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    })

    // Build summary stats from ALL items (unfiltered)
    const allItems = await db.procurementItem.findMany()

    const totalItems = allItems.length
    const totalEstValue = allItems.reduce((sum, item) => sum + (item.totalEst || 0), 0)

    const byStatus: Record<string, number> = {}
    for (const item of allItems) {
      byStatus[item.status] = (byStatus[item.status] || 0) + 1
    }

    const byCategory: Record<string, number> = {}
    for (const item of allItems) {
      byCategory[item.category] = (byCategory[item.category] || 0) + 1
    }

    return NextResponse.json({
      success: true,
      items,
      summary: {
        totalItems,
        totalEstValue,
        byStatus,
        byCategory,
      },
    })
  } catch (error) {
    console.error('[GET /api/procurement] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch procurement items' },
      { status: 500 }
    )
  }
}

// POST /api/procurement - Create single item or array of items
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Accept single item or array
    const itemsArray = Array.isArray(body) ? body : [body]

    if (itemsArray.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No items provided' },
        { status: 400 }
      )
    }

    const VALID_STATUSES = ['pending', 'ordered', 'shipped', 'delivered', 'cancelled']
    const VALID_PRIORITIES = ['normal', 'high', 'urgent']
    const VALID_CATEGORIES = [
      'electronics', 'home', 'clothing', 'food', 'health', 'accessories',
      'other', 'tobacco', 'furniture', 'it_equipment', 'beauty', 'kitchen',
      'sports', 'telecom', 'office', 'automotive', 'wholesale_lot',
    ]

    const created: unknown[] = []
    const errors: { index: number; name: string; errors: string[] }[] = []

    for (let i = 0; i < itemsArray.length; i++) {
      const item = itemsArray[i]
      const itemErrors: string[] = []

      if (!item.name || typeof item.name !== 'string' || item.name.trim() === '') {
        itemErrors.push('name is required')
      }

      if (item.status && !VALID_STATUSES.includes(item.status)) {
        itemErrors.push(`Invalid status: ${item.status}`)
      }

      if (item.priority && !VALID_PRIORITIES.includes(item.priority)) {
        itemErrors.push(`Invalid priority: ${item.priority}`)
      }

      if (item.category && !VALID_CATEGORIES.includes(item.category)) {
        itemErrors.push(`Invalid category: ${item.category}`)
      }

      if (itemErrors.length > 0) {
        errors.push({ index: i, name: item.name || `Item ${i}`, errors: itemErrors })
        continue
      }

      const quantity = Number(item.quantity) || 1
      const unitPriceEst = Number(item.unitPriceEst) || 0

      const createdItem = await db.procurementItem.create({
        data: {
          name: item.name.trim(),
          brand: item.brand || null,
          reference: item.reference || null,
          category: item.category || 'electronics',
          quantity,
          unitPriceEst,
          totalEst: quantity * unitPriceEst,
          currency: item.currency || 'USD',
          recipientName: item.recipientName || 'Younes Tsouli',
          recipientAddress: item.recipientAddress || null,
          deliveryAddress: item.deliveryAddress || null,
          prePaidBySwarm: item.prePaidBySwarm !== undefined ? Boolean(item.prePaidBySwarm) : true,
          status: item.status || 'pending',
          orderRef: item.orderRef || null,
          supplier: item.supplier || null,
          notes: item.notes || null,
          priority: item.priority || 'normal',
          fulfillmentSource: item.fulfillmentSource || null,
        },
      })

      created.push(createdItem)
    }

    return NextResponse.json({
      success: true,
      created,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (error) {
    console.error('[POST /api/procurement] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to create procurement item(s)' },
      { status: 500 }
    )
  }
}
