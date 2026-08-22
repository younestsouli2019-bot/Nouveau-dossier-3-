import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

interface FulfillItem {
  id: string
  orderRef?: string
  supplier?: string
}

// POST /api/procurement/fulfill-batch - Mark multiple items as 'ordered' at once
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const items: FulfillItem[] = body.items

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { success: false, error: 'items array is required and must not be empty' },
        { status: 400 }
      )
    }

    const results: { id: string; success: boolean; error?: string }[] = []
    let updatedCount = 0
    let errorCount = 0

    for (const item of items) {
      if (!item.id) {
        results.push({ id: 'unknown', success: false, error: 'id is required' })
        errorCount++
        continue
      }

      try {
        const existing = await db.procurementItem.findUnique({ where: { id: item.id } })
        if (!existing) {
          results.push({ id: item.id, success: false, error: 'Item not found' })
          errorCount++
          continue
        }

        const updateData: Record<string, unknown> = {
          status: 'ordered',
        }

        // Set orderedAt if not already set
        if (!existing.orderedAt) {
          updateData.orderedAt = new Date()
        }

        if (item.orderRef) {
          updateData.orderRef = item.orderRef
        }
        if (item.supplier) {
          updateData.supplier = item.supplier
        }

        await db.procurementItem.update({
          where: { id: item.id },
          data: updateData,
        })

        results.push({ id: item.id, success: true })
        updatedCount++
      } catch (err) {
        results.push({ id: item.id, success: false, error: 'Update failed' })
        errorCount++
      }
    }

    return NextResponse.json({
      success: true,
      updated: updatedCount,
      errors: errorCount,
      results,
    })
  } catch (error) {
    console.error('[POST /api/procurement/fulfill-batch] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to batch fulfill procurement items' },
      { status: 500 }
    )
  }
}
