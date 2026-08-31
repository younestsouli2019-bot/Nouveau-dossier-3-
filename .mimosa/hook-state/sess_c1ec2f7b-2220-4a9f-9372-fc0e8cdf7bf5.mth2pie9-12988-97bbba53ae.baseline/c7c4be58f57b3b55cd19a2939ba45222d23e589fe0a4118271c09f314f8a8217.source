import { NextRequest, NextResponse } from 'next/server'
import { confirmReceipt, findProcurementDiscrepancies, findDeliveredWithoutReceipt, killFabrication } from '@/lib/strict-enforcement'
import type { ConfirmReceiptParams } from '@/lib/strict-enforcement'

export const dynamic = 'force-dynamic'

/**
 * POST /api/procurement/receipt — Confirm receipt (separate from delivery!)
 * Body: { procurementItemId, quantityReceived, quantityDamaged?, condition, confirmedBy?, notes?, proofHash? }
 *
 * TRUTH-ENFORCED: proofHash is MANDATORY (TRUTH-PROC-001)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as ConfirmReceiptParams

    // TRUTH-KILL: Block fabrication attempts
    const fabricationCheck = killFabrication(body as unknown as Record<string, unknown>)
    if (fabricationCheck) return fabricationCheck

    if (!body.procurementItemId || body.quantityReceived === undefined) {
      return NextResponse.json({ success: false, error: 'procurementItemId and quantityReceived are required' }, { status: 400 })
    }

    if (!body.condition) {
      return NextResponse.json({ success: false, error: 'condition is required (good, partial, damaged, wrong_item)' }, { status: 400 })
    }

    // TRUTH-PROC: proofHash is mandatory for receipt confirmation
    if (!body.proofHash || body.proofHash.trim().length < 10) {
      return NextResponse.json({
        success: false,
        error: 'TRUTH-PROC-001: proofHash is MANDATORY for receipt confirmation. ' +
          'Physical/digital receipt must be verified via signed proof (photo hash, signature hash, API receipt hash). ' +
          'Minimum 10 characters required.',
      }, { status: 422 })
    }

    const result = await confirmReceipt(body)
    return NextResponse.json(result, { status: result.success ? 200 : 400 })
  } catch (error) {
    console.error('[Procurement/Receipt]', error)
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
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
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}
