// ——— Strict Procurement Enforcement (RWC Patched) ———
// Delivery ≠ Receipt. A shipment can be delivered but NOT received (wrong item, damaged, missing).
// This module enforces the split: delivery is carrier-side, receipt is owner-side.
// ———————————————————————————————————————————————————————————————————

import { db } from '@/lib/db'
import { sha256 } from './crypto-utils'

export interface ConfirmReceiptParams {
  procurementItemId: string
  quantityReceived: number
  quantityDamaged?: number
  condition: 'good' | 'partial' | 'damaged' | 'wrong_item'
  confirmedBy?: string
  notes?: string
  proofHash?: string
}

export interface ReceiptResult {
  success: boolean
  item?: Record<string, unknown>
  error?: string
  discrepancy?: {
    orderedQty: number
    receivedQty: number
    damagedQty: number
    hasDiscrepancy: boolean
    note: string
  }
}

/**
 * Confirm receipt of a procurement item.
 * This is SEPARATE from delivery.
 *
 * Rules:
 * 1. Item must be 'shipped' or 'delivered' before receipt can be confirmed
 * 2. quantityReceived is REQUIRED (no more assuming 100% delivery)
 * 3. Discrepancy is auto-detected: quantityReceived !== ordered quantity
 * 4. A proofHash can be attached for photographic/evidence proof
 */
export async function confirmReceipt(params: ConfirmReceiptParams): Promise<ReceiptResult> {
  const { procurementItemId, quantityReceived, quantityDamaged = 0, condition, confirmedBy = 'system', notes, proofHash } = params

  const existing = await db.procurementItem.findUnique({ where: { id: procurementItemId } })
  if (!existing) {
    return { success: false, error: 'Procurement item not found' }
  }

  // RULE 1: Must be shipped or delivered first
  if (!['shipped', 'delivered'].includes(existing.status)) {
    return { success: false, error: `Cannot confirm receipt for item in status '${existing.status}'. Must be 'shipped' or 'delivered' first.` }
  }

  // RULE 1b: proofHash is MANDATORY for receipt confirmation (TRUTH-PROC)
  if (!proofHash || proofHash.trim().length < 10) {
    return {
      success: false,
      error: 'TRUTH-PROC VIOLATION: receipt confirmation REQUIRES a deliveryProofHash (min 10 chars). ' +
        'Physical/digital receipt must be verified via signed proof (photo, signature, API receipt hash). ' +
        'Operation KILLED. Rule: TRUTH-PROC-001',
    }
  }

  // RULE 2: quantityReceived is required and must be >= 0
  if (quantityReceived < 0 || quantityReceived > existing.quantity * 2) {
    return { success: false, error: `Invalid quantityReceived: ${quantityReceived}. Must be 0 to ${existing.quantity * 2}.` }
  }

  // Detect discrepancy
  const hasDiscrepancy = quantityReceived !== existing.quantity
  const discrepancy = hasDiscrepancy ? {
    orderedQty: existing.quantity,
    receivedQty: quantityReceived,
    damagedQty: quantityDamaged,
    hasDiscrepancy: true,
    note: quantityReceived < existing.quantity
      ? `SHORT DELIVERY: Expected ${existing.quantity}, received ${quantityReceived}. ${quantityDamaged > 0 ? `${quantityDamaged} damaged.` : ''}`
      : `OVER DELIVERY: Expected ${existing.quantity}, received ${quantityReceived}.`,
  } : undefined

  // Update the item
  const updated = await db.procurementItem.update({
    where: { id: procurementItemId },
    data: {
      status: hasDiscrepancy ? 'delivered' : 'delivered', // keep delivered but flag discrepancy
      deliveredAt: existing.deliveredAt ?? new Date(),
      receiptConfirmedBy: confirmedBy,
      receiptConfirmedAt: new Date(),
      quantityReceived,
      quantityDamaged,
      receiptCondition: condition,
      receiptNotes: notes,
      receiptDiscrepancy: hasDiscrepancy,
      deliveryProofHash: proofHash ?? existing.deliveryProofHash,
    },
  })

  // Write audit entry
  try {
    const lastAudit = await db.auditLedger.findFirst({
      where: { entityType: 'procurement_item' },
      orderBy: { createdAt: 'desc' },
    })
    const entryContent = JSON.stringify({
      entityType: 'procurement_item', entityId: procurementItemId,
      action: 'receipt_confirmed', orderedQty: existing.quantity,
      receivedQty: quantityReceived, damagedQty: quantityDamaged,
      condition, hasDiscrepancy,
    })
    await db.auditLedger.create({
      data: {
        entityType: 'procurement_item', entityId: procurementItemId,
        action: 'receipt_confirmed',
        previousHash: lastAudit?.entryHash ?? null,
        entryHash: sha256(entryContent),
        proofHash: proofHash ?? null,
        performedBy: confirmedBy,
        metadata: JSON.stringify({ itemName: existing.name, discrepancy }),
      },
    })
  } catch (e) { console.error('[Procurement] Audit write failed:', e) }

  // If there's a linked PO, check if all items are received
  if (existing.purchaseOrderId) {
    try {
      const poItems = await db.procurementItem.findMany({ where: { purchaseOrderId: existing.purchaseOrderId } })
      const allReceived = poItems.every(item => {
        const itemAny = item as Record<string, unknown>
        return itemAny.receiptConfirmedAt !== null && itemAny.receiptConfirmedAt !== undefined
      })
      if (allReceived && poItems.length > 0) {
        await db.purchaseOrder.update({
          where: { id: existing.purchaseOrderId },
          data: { status: 'completed', completedAt: new Date() },
        })
      }
    } catch (e) { console.error('[Procurement] PO status update failed:', e) }
  }

  return { success: true, item: updated as unknown as Record<string, unknown>, discrepancy }
}

/**
 * Validate that a procurement item / PO write honors the pre-paid rules.
 *
 * OWNER DIRECTIVE (2026-08-20):
 *  - When ownerInitiated = true: recipient NEVER disburses. prePaidBySwarm MUST equal true.
 *    Vendor invoices are paid out of OWNER CMI/MMB/Wise/BankingCircle treasury rails ONLY.
 *  - When ownerInitiated = false (third-party PO): normal commercial terms apply.
 *    prePaidBySwarm can be false; COD / NET terms are allowed between the non-owner parties.
 */
export interface ProcurementPaymentWrite {
  prePaidBySwarm?: boolean
  ownerInitiated?: boolean
}

export function enforcePrepaidPolicy(write: ProcurementPaymentWrite): {
  valid: boolean
  prePaidBySwarm: boolean
  ownerInitiated: boolean
  violations: string[]
} {
  const violations: string[] = []
  const ownerInitiated = write.ownerInitiated !== false
  let prePaidBySwarm = write.prePaidBySwarm

  if (ownerInitiated) {
    if (prePaidBySwarm === false) {
      violations.push('TRUTH-PROC-002: owner-initiated procurement prePaidBySwarm locked to true (recipients do not disburse)')
    }
    prePaidBySwarm = true
  }
  return {
    valid: violations.length === 0,
    prePaidBySwarm,
    ownerInitiated,
    violations,
  }
}

/**
 * Find all procurement items with delivery/receipt discrepancies.
 */
export async function findProcurementDiscrepancies() {
  return db.procurementItem.findMany({
    where: { receiptDiscrepancy: true },
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * Find items delivered but NOT yet receipt-confirmed.
 */
export async function findDeliveredWithoutReceipt() {
  const items = await db.procurementItem.findMany({
    where: { status: 'delivered' },
    orderBy: { deliveredAt: 'desc' },
  })
  return items.filter(item => {
    const itemAny = item as Record<string, unknown>
    return !itemAny.receiptConfirmedAt
  })
}
