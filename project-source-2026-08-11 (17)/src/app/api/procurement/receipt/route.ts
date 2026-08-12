import { NextRequest, NextResponse } from 'next/server'
import { confirmReceipt, findProcurementDiscrepancies, findDeliveredWithoutReceipt } from '@/lib/strict-enforcement'
import type { ConfirmReceiptParams } from '@/lib/strict-enforcement'

export const dynamic = 'force-dynamic'

/**
 * POST /api/procurement/receipt — Confirm receipt (separate from delivery!)
 * Body: { procurementItemId, quantityReceived, quantityDamaged?, condition, confirmedBy?, notes?, proofHash? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as ConfirmReceiptParams

    if (!body.procurementItemId || body.quantityReceived === undefined) {
      return NextResponse.json({ success: false, error: 'procurementItemId and quantityReceived are required' }, { status: 400 })
    }

    if (!body.condition) {
      return NextResponse.json({ success: false, error: 'condition is required (good, partial, damaged, wrong_item)' }, { status: 400 })
    }

    const result = await confirmReceipt(body)
    return NextResponse.json(result, { status: result.success ? 200 : 400 })
  } catch (error) {
    console.error('[Procurement/Receipt]', error)
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 })
  }
}

/**
 * GET /api/procurement/receipt — List discrepancies and delivered-without-receipt
 */
export async function GET() {
  try {
    const [discrepancies, noReceipt] = await Promise.all([findProcurementDiscrepancies(), findDeliveredWithoutReceipt()])
    return NextResponse.json({ success: true, discrepancies, deliveredWithoutReceipt: noReceipt })
  } catch (error) {
    console.error('[Procurement/Receipt GET]', error)
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed' }, { status: 500 })
  }
}
