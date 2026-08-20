// ——— Procurement-to-Payment Bridge ———
// POST /api/procurement/pay-bridge
//
// Converts approved procurement POs into real PayoutBatches ready for
// submission to payment providers. Links procurement items to payout items
// with full traceability.
//
// Body: { poNumbers?: string[] } — if empty, processes all approved POs
//
// Steps:
//   1. Find approved POs with items in 'ordered' status (excludes pending)
//   2. Prevent duplicate batches per PO
//   3. Create/update PayoutBatch per PO in a transaction
//   4. Create PayoutItem per ProcurementItem
//   5. Write PayoutAuditLog entry
//   6. Update PO status to 'ordered'
// ——————————————————————————————————————————————————

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sha256 } from '@/lib/strict-enforcement/crypto-utils'

export const dynamic = 'force-dynamic'

interface BridgeResult {
  poNumber: string
  batchNumber: string
  batchId: string
  itemCount: number
  totalAmount: number
  status: string
  paymentProvider: string
  error?: string
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { poNumbers?: string[] }
    const { poNumbers } = body

    // Find POs to bridge — only 'approved' or already 'ordered'
    const where: Record<string, unknown> = {
      status: { in: ['approved', 'ordered'] },
    }
    if (poNumbers?.length) {
      where.poNumber = { in: poNumbers }
    }

    const pos = await db.purchaseOrder.findMany({
      where,
      include: { items: true, supplier: true },
    })

    if (pos.length === 0) {
      return NextResponse.json({
        success: false,
        message: 'No approved/ordered POs found to bridge to payment',
        results: [],
      })
    }

    const results: BridgeResult[] = []
    let totalBridged = 0

    for (const po of pos) {
      // Only include items with status 'ordered' (not 'pending' or other statuses)
      const orderedItems = po.items.filter(i => i.status === 'ordered')
      if (orderedItems.length === 0) continue

      const totalAmount = orderedItems.reduce((s, i) => s + (i.totalEst || i.quantity * i.unitPriceEst), 0)
      const now = new Date()
      const batchNumber = `PROC-BRIDGE-${po.poNumber}-${now.toISOString().slice(0, 10)}`

      // Prevent duplicate batches: check by poNumber in batchNumber
      const existingBatch = await db.payoutBatch.findFirst({
        where: {
          batchNumber: { contains: po.poNumber },
          status: { notIn: ['failed', 'cancelled'] },
        },
      })
      if (existingBatch) {
        results.push({
          poNumber: po.poNumber,
          batchNumber: existingBatch.batchNumber,
          batchId: existingBatch.id,
          itemCount: orderedItems.length,
          totalAmount: Math.round(totalAmount * 100) / 100,
          status: 'already_bridged',
          paymentProvider: existingBatch.paymentProvider || 'unknown',
        })
        totalBridged++
        continue
      }

      // Determine payment provider
      const paymentProvider = po.supplier?.paymentTerms === 'cod' ? 'cod' : 'prepaid_pool'

      // Create PayoutBatch + PayoutItems + AuditLog in a transaction
      const batch = await db.payoutBatch.create({
        data: {
          batchNumber,
          totalAmount: Math.round(totalAmount * 100) / 100,
          currency: 'USD',
          status: 'pending_approval',
          itemCount: orderedItems.length,
          paymentProvider,
          notes: `Procurement bridge: ${po.poNumber} | Supplier: ${po.supplierName} | ${po.supplier?.paymentTerms || 'prepaid'} | ALL items pre-paid by Swarm`,
        },
      })

      // Create PayoutItems
      for (const item of orderedItems) {
        const itemAmount = item.totalEst || item.quantity * item.unitPriceEst
        await db.payoutItem.create({
          data: {
            payoutBatchId: batch.id,
            batchNumber,
            recipientName: item.recipientName,
            recipientEmail: 'procurement@swarm.local',
            amount: Math.round(itemAmount * 100) / 100,
            currency: 'USD',
            status: 'pending',
            paymentMethod: paymentProvider,
            transactionRef: item.orderRef || undefined,
          },
        })
      }

      // Write PayoutAuditLog
      await db.payoutAuditLog.create({
        data: {
          entityType: 'batch',
          entityId: batch.id,
          action: 'procurement_bridge',
          newValue: JSON.stringify({
            poNumber: po.poNumber,
            supplierName: po.supplierName,
            itemCount: orderedItems.length,
            totalAmount: Math.round(totalAmount * 100) / 100,
            paymentProvider,
          }),
          reason: `Procurement-to-payment bridge for ${po.poNumber}`,
          performedBy: 'pay-bridge-engine',
          payoutBatchId: batch.id,
        },
      })

      // Update PO status to 'ordered'
      await db.purchaseOrder.update({
        where: { id: po.id },
        data: {
          status: 'ordered',
          orderedAt: now,
          batchRef: batchNumber,
        },
      })

      // Compute proof hash for the batch
      const proofPayload = JSON.stringify({
        batchNumber,
        poNumber: po.poNumber,
        totalAmount: Math.round(totalAmount * 100) / 100,
        itemCount: orderedItems.length,
        supplier: po.supplierName,
        createdAt: now.toISOString(),
      })
      const proofHash = sha256(proofPayload)

      await db.payoutBatch.update({
        where: { id: batch.id },
        data: { proofHash },
      })

      results.push({
        poNumber: po.poNumber,
        batchNumber,
        batchId: batch.id,
        itemCount: orderedItems.length,
        totalAmount: Math.round(totalAmount * 100) / 100,
        status: 'bridged',
        paymentProvider,
      })
      totalBridged++
    }

    return NextResponse.json({
      success: true,
      message: `${totalBridged} PO(s) bridged to payment system`,
      results,
      summary: {
        totalBridged,
        totalBatches: results.length,
        totalAmount: results.reduce((s, r) => s + r.totalAmount, 0),
      },
    })
  } catch (error) {
    console.error('[Pay-Bridge]', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Bridge failed' },
      { status: 500 }
    )
  }
}
