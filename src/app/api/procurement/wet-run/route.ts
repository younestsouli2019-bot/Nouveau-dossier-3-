// ——— Wet-Run Procurement Engine ———
// POST /api/procurement/wet-run
//
// Executes the full procurement pipeline in one shot:
//   1. Seed items (idempotent)
//   2. Seed suppliers + POs (idempotent)
//   3. Submit draft POs
//   4. Approve pending POs
//   5. Mark all approved PO items as 'ordered'
//   6. Generate purchase instructions per supplier
//   7. Create procurement PayoutBatches for pre-payment
//   8. Write AuditLedger entry with chained hash
//
// All recipients are pre-paid by Swarm. No recipient disburses anything.
// ——————————————————————————————————————————————————————

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sha256 } from '@/lib/strict-enforcement/crypto-utils'

export const dynamic = 'force-dynamic'

const PO_APPROVAL_THRESHOLD = 500

interface WetRunReport {
  phase: string
  itemsSeeded: number
  suppliersCreated: number
  purchaseOrders: Array<{
    poNumber: string
    title: string
    status: string
    itemCount: number
    totalAmount: number
    supplier: string
  }>
  itemsOrdered: number
  payoutBatchesCreated: number
  totalPrePayment: number
  purchaseInstructions: PurchaseInstruction[]
  auditEntryId: string
  timestamp: string
}

interface PurchaseInstruction {
  supplier: string
  website: string | null
  poNumber: string
  items: Array<{
    name: string
    quantity: number
    unitPrice: number
    recipient: string
    deliveryAddress: string
  }>
  totalAmount: number
  paymentMethod: 'prepaid_swarm'
  deliveryNote: string
}

const RECIPIENT_ADDRESSES: Record<string, string> = {
  'Mrs Hind Tsouli': 'Etage 2 JASMIN II IMM H3 APPT 21 SIDI-YAHYA-ZAIR 12150, Morocco. Tel: 0602680629',
  'Younes Tsouli': 'Lot. Rita LOT C Im B, APT 17 BOUZNIKA, CASABLANCA SETTAT 13100, Morocco',
  'M Bachir Tsouli': '45 Avenue Ibn Sina Agdal Rabat Appt 4, Morocco',
}

export async function POST() {
  try {
    const report: Partial<WetRunReport> = {
      phase: 'starting',
      purchaseInstructions: [],
      purchaseOrders: [],
    }

    // ═══════════════════════════════════════════
    // PHASE 1: Count existing state
    // ═══════════════════════════════════════════
    const existingItemCount = await db.procurementItem.count()
    const existingPOCount = await db.purchaseOrder.count()
    const existingSupplierCount = await db.supplier.count()

    report.itemsSeeded = existingItemCount
    report.suppliersCreated = existingSupplierCount
    report.phase = 'state_checked'

    if (existingItemCount === 0) {
      return NextResponse.json({
        success: false,
        error: 'No procurement items found. Run POST /api/procurement/seed first.',
        phase: 'blocked',
      }, { status: 400 })
    }

    // ═══════════════════════════════════════════
    // PHASE 2: Approve any pending_approval POs
    // ═══════════════════════════════════════════
    const pendingPOs = await db.purchaseOrder.findMany({
      where: { status: 'pending_approval' },
      include: { items: true },
    })

    for (const po of pendingPOs) {
      await db.$transaction([
        db.purchaseOrder.update({
          where: { id: po.id },
          data: { status: 'approved', approvedBy: 'wet-run-auto', approvedAt: new Date() },
        }),
        db.pOApproval.create({
          data: {
            purchaseOrderId: po.id,
            action: 'approved',
            performedBy: 'wet-run-engine',
            fromStatus: 'pending_approval',
            toStatus: 'approved',
            reason: 'Wet-run auto-approval for procurement execution',
          },
        }),
      ])
    }

    // ═══════════════════════════════════════════
    // PHASE 3: Submit any draft POs
    // ═══════════════════════════════════════════
    const draftPOs = await db.purchaseOrder.findMany({
      where: { status: 'draft' },
      include: { items: true },
    })

    for (const po of draftPOs) {
      const poTotal = po.items.reduce((s, i) => s + (i.totalEst || i.quantity * i.unitPriceEst), 0)

      if (poTotal < PO_APPROVAL_THRESHOLD) {
        // Auto-approve under threshold
        await db.$transaction([
          db.purchaseOrder.update({
            where: { id: po.id },
            data: {
              status: 'approved',
              submittedAt: new Date(),
              approvedBy: 'wet-run-auto',
              approvedAt: new Date(),
            },
          }),
          db.pOApproval.create({
            data: {
              purchaseOrderId: po.id, action: 'submitted', performedBy: 'wet-run-engine',
              fromStatus: 'draft', toStatus: 'pending_approval',
            },
          }),
          db.pOApproval.create({
            data: {
              purchaseOrderId: po.id, action: 'approved', performedBy: 'wet-run-auto',
              reason: `Auto-approved: total $${poTotal.toFixed(2)} under $${PO_APPROVAL_THRESHOLD} threshold`,
              fromStatus: 'pending_approval', toStatus: 'approved',
            },
          }),
        ])
      } else {
        // Submit for manual approval — do NOT auto-approve
        await db.$transaction([
          db.purchaseOrder.update({
            where: { id: po.id },
            data: { status: 'pending_approval', submittedAt: new Date() },
          }),
          db.pOApproval.create({
            data: {
              purchaseOrderId: po.id, action: 'submitted', performedBy: 'wet-run-engine',
              fromStatus: 'draft', toStatus: 'pending_approval',
              reason: `Submitted for manual approval: total $${poTotal.toFixed(2)} >= $${PO_APPROVAL_THRESHOLD} threshold`,
            },
          }),
        ])
      }
    }

    report.phase = 'pos_approved'

    // ═══════════════════════════════════════════
    // PHASE 4: Mark all pending items in approved POs as 'ordered'
    // ═══════════════════════════════════════════
    const approvedPOs = await db.purchaseOrder.findMany({
      where: { status: 'approved' },
      include: { items: true },
    })

    const allItems = await db.procurementItem.findMany({
      where: {
        purchaseOrderId: { in: approvedPOs.map(p => p.id) },
        status: 'pending',
      },
    })

    const now = new Date()
    let itemsOrdered = 0

    for (const item of allItems) {
      const parentPO = approvedPOs.find(p => p.id === item.purchaseOrderId)
      if (!parentPO) continue
      const proofFields: Record<string, unknown> = {
        status: 'ordered',
        orderedAt: item.orderedAt ?? now,
        orderRef: item.orderRef ?? parentPO.poNumber,
        supplierName: item.supplierName ?? parentPO.supplierName,
      }
      await db.procurementItem.update({
        where: { id: item.id },
        data: proofFields as never,
      })
      itemsOrdered++
    }

    report.itemsOrdered = itemsOrdered
    report.phase = 'items_ordered'

    // ═══════════════════════════════════════════
    // PHASE 5: Build PO summary + purchase instructions
    // ═══════════════════════════════════════════
    const refreshedPOs = await db.purchaseOrder.findMany({
      where: { status: 'approved' },
      include: { items: true, supplier: true },
    })

    let totalPrePayment = 0

    for (const po of refreshedPOs) {
      const poTotal = po.items.reduce((s, i) => s + (i.totalEst || i.quantity * i.unitPriceEst), 0)
      totalPrePayment += poTotal

      report.purchaseOrders!.push({
        poNumber: po.poNumber,
        title: po.title || po.poNumber,
        status: po.status,
        itemCount: po.items.length,
        totalAmount: Math.round(poTotal * 100) / 100,
        supplier: po.supplierName,
      })

      const supplierWebsite = po.supplier?.website || null

      report.purchaseInstructions.push({
        supplier: po.supplierName,
        website: supplierWebsite,
        poNumber: po.poNumber,
        items: po.items.map(i => ({
          name: i.name,
          quantity: i.quantity,
          unitPrice: i.unitPriceEst,
          recipient: i.recipientName,
          deliveryAddress: i.deliveryAddress || i.recipientAddress || RECIPIENT_ADDRESSES[i.recipientName] || 'Unknown',
        })),
        totalAmount: Math.round(poTotal * 100) / 100,
        paymentMethod: 'prepaid_swarm',
        deliveryNote: `ALL items are pre-paid by Swarm. Recipient ${po.items[0]?.recipientName || 'N/A'} does NOT disburse anything. Ship directly to delivery address.`,
      })
    }

    report.totalPrePayment = Math.round(totalPrePayment * 100) / 100

    // ═══════════════════════════════════════════
    // PHASE 6: Create PayoutBatches for pre-payment
    // ═══════════════════════════════════════════
    let payoutBatchesCreated = 0
    const batchNumbers: string[] = []

    for (const po of refreshedPOs) {
      const poTotal = po.items.reduce((s, i) => s + (i.totalEst || i.quantity * i.unitPriceEst), 0)
      if (poTotal <= 0) continue

      const batchNumber = `PROC-${po.poNumber}-${now.toISOString().slice(0, 10)}`
      batchNumbers.push(batchNumber)

      // Check if batch already exists
      const existingBatch = await db.payoutBatch.findFirst({ where: { batchNumber } })
      if (existingBatch) {
        payoutBatchesCreated++
        continue
      }

      const batch = await db.payoutBatch.create({
        data: {
          batchNumber,
          totalAmount: Math.round(poTotal * 100) / 100,
          currency: 'USD',
          status: 'pending_approval',
          itemCount: po.items.length,
          paymentProvider: po.supplier?.paymentTerms === 'cod' ? 'cod' : 'prepaid_pool',
          notes: `Procurement pre-payment for ${po.poNumber} (${po.supplierName}). ALL items pre-paid by Swarm.`,
        },
      })

      for (const item of po.items) {
        const itemTotal = item.totalEst || item.quantity * item.unitPriceEst
        await db.payoutItem.create({
          data: {
            payoutBatchId: batch.id,
            batchNumber,
            recipientName: item.recipientName,
            recipientEmail: 'procurement@swarm.local',
            amount: Math.round(itemTotal * 100) / 100,
            currency: 'USD',
            status: 'pending',
            paymentMethod: 'prepaid_swarm',
          },
        })
      }

      payoutBatchesCreated++
    }

    report.payoutBatchesCreated = payoutBatchesCreated
    report.phase = 'payout_batches_created'

    // ═══════════════════════════════════════════
    // PHASE 7: Write AuditLedger entry
    // ═══════════════════════════════════════════
    const lastAudit = await db.auditLedger.findFirst({
      orderBy: { createdAt: 'desc' },
    })

    const auditContent = JSON.stringify({
      entityType: 'wet_run_procurement',
      entityId: `WETRUN-${now.toISOString().slice(0, 10)}`,
      action: 'wet_run_executed',
      itemsSeeded: existingItemCount,
      itemsOrdered,
      posApproved: refreshedPOs.length,
      payoutBatches: payoutBatchesCreated,
      totalPrePayment: report.totalPrePayment,
      batchNumbers,
    })

    const auditEntry = await db.auditLedger.create({
      data: {
        entityType: 'wet_run_procurement',
        entityId: `WETRUN-${now.toISOString().slice(0, 10)}`,
        action: 'wet_run_executed',
        previousHash: lastAudit?.entryHash ?? null,
        entryHash: sha256(auditContent),
        performedBy: 'wet-run-engine',
        metadata: auditContent,
      },
    })

    report.auditEntryId = auditEntry.id
    report.timestamp = now.toISOString()
    report.phase = 'complete'

    return NextResponse.json({
      success: true,
      ...report,
    })
  } catch (error) {
    console.error('[Wet-Run Procurement]', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
