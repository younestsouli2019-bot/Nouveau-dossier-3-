import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST /api/procurement/[id]/deliver - Mark a single item as delivered
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const existing = await db.procurementItem.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Procurement item not found' },
        { status: 404 }
      )
    }

    if (existing.status === 'delivered') {
      return NextResponse.json(
        { success: false, error: 'Item is already marked as delivered' },
        { status: 400 }
      )
    }

    if (existing.status === 'cancelled') {
      return NextResponse.json(
        { success: false, error: 'Cannot deliver a cancelled item' },
        { status: 400 }
      )
    }

    const updated = await db.procurementItem.update({
      where: { id },
      data: {
        status: 'delivered',
        deliveredAt: new Date(),
        // Also set shippedAt if not already set (delivered implies shipped)
        shippedAt: existing.shippedAt || new Date(),
        orderedAt: existing.orderedAt || new Date(),
      },
    })

    return NextResponse.json({ success: true, item: updated })
  } catch (error) {
    console.error(`[POST /api/procurement/${'id'}/deliver] Error:`, error)
    return NextResponse.json(
      { success: false, error: 'Failed to mark item as delivered' },
      { status: 500 }
    )
  }
}
