// ——— Three-Way Match API ———
// POST /api/procurement/three-way-match
//
// Runs PO ↔ Receipt ↔ Invoice matching for all procurement items.
//
// POST body (optional): { invoiceData?: Array<{ itemId, invoiceAmount, invoiceQty, invoiceUnitPrice }> }
// GET — returns last match report
// ——————————————————————————————————————————

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { runThreeWayMatch } from '@/lib/procurement'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      invoiceData?: Array<{
        itemId: string
        invoiceAmount: number
        invoiceQty?: number
        invoiceUnitPrice?: number
      }>
    }

    // If invoice data provided, inject it into procurement item notes
    if (body.invoiceData?.length) {
      for (const inv of body.invoiceData) {
        const item = await db.procurementItem.findUnique({ where: { id: inv.itemId } })
        if (!item) continue

        let existingNotes: Record<string, unknown> = {}
        try { existingNotes = JSON.parse(item.notes || '{}') } catch { /* keep as-is */ }

        const updatedNotes = {
          ...existingNotes,
          invoiceAmount: inv.invoiceAmount,
          invoiceQty: inv.invoiceQty || item.quantity,
          invoiceUnitPrice: inv.invoiceUnitPrice || (inv.invoiceAmount / (inv.invoiceQty || item.quantity)),
          invoiceInjectedAt: new Date().toISOString(),
        }

        await db.procurementItem.update({
          where: { id: inv.itemId },
          data: { notes: JSON.stringify(updatedNotes) },
        })
      }
    }

    const report = await runThreeWayMatch()

    return NextResponse.json({
      success: true,
      ...report,
    })
  } catch (error) {
    console.error('[Three-Way Match]', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Three-way match failed' },
      { status: 500 }
    )
  }
}

export async function GET() {
  try {
    const report = await runThreeWayMatch()

    return NextResponse.json({
      success: true,
      ...report,
    })
  } catch (error) {
    console.error('[Three-Way Match]', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Three-way match failed' },
      { status: 500 }
    )
  }
}
