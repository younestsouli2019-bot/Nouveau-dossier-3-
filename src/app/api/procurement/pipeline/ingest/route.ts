import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseProcurementText, type ProcurementRequestItem } from '@/lib/procurement/pipeline'

/**
 * POST /api/procurement/pipeline/ingest
 * Body: { sourceText?: string, items?: ProcurementRequestItem[] }
 * Parses raw procurement text (or accepts structured items) and upserts
 * ProcurementItem records. Items are created 'pending' — nothing is paid here.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { sourceText, items } = body as {
      sourceText?: string
      items?: ProcurementRequestItem[]
    }

    let parsed: ProcurementRequestItem[] = []
    if (Array.isArray(items) && items.length > 0) {
      parsed = items
    } else if (typeof sourceText === 'string' && sourceText.trim().length > 0) {
      parsed = parseProcurementText(sourceText)
    } else {
      return NextResponse.json(
        { success: false, error: 'Provide either sourceText or a non-empty items array' },
        { status: 400 },
      )
    }

    let created = 0
    const results: Array<{ name: string; action: 'created' | 'existing'; id: string }> = []
    for (const item of parsed) {
      const existing = await db.procurementItem.findFirst({
        where: { name: item.name, recipientName: item.recipientName },
      })
      if (existing) {
        results.push({ name: item.name, action: 'existing', id: existing.id })
        continue
      }
      const record = await db.procurementItem.create({
        data: {
          name: item.name,
          brand: item.brand ?? null,
          reference: item.reference ?? null,
          category: item.category ?? 'other',
          quantity: item.quantity || 1,
          unitPriceEst: item.unitPriceEst ?? 0,
          totalEst: Math.round((item.unitPriceEst ?? 0) * (item.quantity || 1) * 100) / 100,
          currency: item.currency ?? 'USD',
          recipientName: item.recipientName,
          recipientAddress: item.recipientAddress ?? null,
          prePaidBySwarm: true,
          status: 'pending',
          supplierName: item.supplierHint ?? null,
          notes: item.notes ?? null,
          priority: item.priority ?? 'normal',
        },
      })
      created++
      results.push({ name: item.name, action: 'created', id: record.id })
    }

    return NextResponse.json({
      success: true,
      created,
      totalItems: results.length,
      items: results,
    })
  } catch (error) {
    console.error('Error ingesting procurement pipeline:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to ingest procurement pipeline' },
      { status: 500 },
    )
  }
}
