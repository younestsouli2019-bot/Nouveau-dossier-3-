import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { scoreProcurementItems, type ScoredItem } from '@/lib/procurement/pipeline'

/**
 * POST /api/procurement/pipeline/score
 * Body: { itemIds?: string[] } — defaults to all pending items.
 * Scores items against active suppliers using the weighted sourcing model
 * (0.40 price / 0.45 locality / 0.15 reliability). Results are returned but
 * NOT persisted as supplier links — PO generation consumes them directly.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const { itemIds } = body as { itemIds?: string[] }

    const where = itemIds && itemIds.length > 0
      ? { id: { in: itemIds } }
      : { status: { in: ['pending', 'ordered'] } }

    const dbItems = await db.procurementItem.findMany({ where })
    if (dbItems.length === 0) {
      return NextResponse.json({ success: true, scoredItems: [], warning: 'No procurement items to score' })
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

    const scored: ScoredItem[] = await scoreProcurementItems(items)

    const topSupplier = scored.length > 0 ? scored[0].scores[0]?.supplierName ?? null : null
    return NextResponse.json({
      success: true,
      scoredCount: scored.length,
      topSupplier,
      scoringModel: { weights: { price: 0.4, locality: 0.45, reliability: 0.15 }, tiers: ['tier1 <50mi', 'tier2 <1000mi', 'tier3 ≥1000mi'] },
      scoredItems: scored,
    })
  } catch (error) {
    console.error('Error scoring procurement items:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to score procurement items' },
      { status: 500 },
    )
  }
}
