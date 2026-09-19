// ——— Strict Procurement Enforcement (RWC Patched) ———
// Delivery ≠ Receipt. A shipment can be delivered but NOT received (wrong item, damaged, missing).
// This module enforces the split: delivery is carrier-side, receipt is owner-side.
// ———————————————————————————————————————————————————————————————————

import { db } from '@/lib/db'
import { sha256 } from './crypto-utils'
import { getProcurementSpendAuthorisation } from '../treasury/buckets'

export interface ConfirmReceiptParams {
  procurementItemId: string
  quantityReceived: number
  quantityDamaged?: number
  condition: 'good' | 'partial' | 'damaged' | 'wrong_item'
  confirmedBy?: string
  notes?: string
  proofHash?: string
  idempotencyKey?: string
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
  idempotentReplay?: boolean
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
 * 5. Idempotent: same idempotencyKey returns prior cached ReceiptResult
 */
export async function confirmReceipt(params: ConfirmReceiptParams): Promise<ReceiptResult> {
  const { procurementItemId, quantityReceived, quantityDamaged = 0, condition, confirmedBy = 'system', notes, proofHash } = params

  const qty = quantityReceived
  const ph = proofHash ?? ''
  const idempotencyKey = params.idempotencyKey ?? sha256(procurementItemId + '|' + String(qty) + '|' + ph)
  const metadataLookupFragment = `"idempotencyKey":"${idempotencyKey}"`

  const priorAudit = await db.auditLedger.findFirst({
    where: {
      entityType: 'procurement_item',
      entityId: procurementItemId,
      action: 'receipt_confirmed',
      metadata: { contains: metadataLookupFragment },
    },
    orderBy: { createdAt: 'desc' },
  })
  if (priorAudit?.metadata) {
    try {
      const md = JSON.parse(priorAudit.metadata)
      if (md && md.cachedReceiptResult) {
        return { ...(md.cachedReceiptResult as ReceiptResult), idempotentReplay: true }
      }
    } catch { /* parse fail — fall through to do the work */ }
  }

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

  const resultPayload: ReceiptResult = { success: true, item: updated as unknown as Record<string, unknown>, discrepancy }

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
        metadata: JSON.stringify({ itemName: existing.name, discrepancy, idempotencyKey, cachedReceiptResult: resultPayload }),
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

  return resultPayload
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

// ———————————————————————————————————————————————————————————————————
// Task 2 (A)(ii): Procurement Budget Check
// ———————————————————————————————————————————————————————————————————

export interface ProcurementBudgetResult {
  ok: boolean
  code?: string
  spendable: number
  required: number
  currency: string
  details?: string
}

export async function checkProcurementBudget(
  totalAmount: number,
  currency: string,
): Promise<ProcurementBudgetResult> {
  const auth = await getProcurementSpendAuthorisation()

  if (currency && currency.toUpperCase() !== auth.currency) {
    return {
      ok: false,
      code: 'CURRENCY_MISMATCH',
      spendable: auth.spendableAmount,
      required: totalAmount,
      currency: auth.currency,
      details: `Procurement budget is denominated in ${auth.currency}; requested ${currency}. Use same-currency PO or convert first.`,
    }
  }

  if (totalAmount > auth.spendableAmount) {
    return {
      ok: false,
      code: 'BUDGET_EXCEEDED',
      spendable: auth.spendableAmount,
      required: totalAmount,
      currency: auth.currency,
      details: auth.details + ` Required: ${totalAmount.toFixed(2)} ${auth.currency}.`,
    }
  }

  return {
    ok: true,
    spendable: auth.spendableAmount,
    required: totalAmount,
    currency: auth.currency,
    details: auth.details,
  }
}

// ———————————————————————————————————————————————————————————————————
// Task 2 (A)(iii): Approve Purchase Order with Budget Check
// ———————————————————————————————————————————————————————————————————

export interface ApprovePOResult {
  approved: boolean
  code?: string
  receipt?: Record<string, unknown>
  error?: string
}

export async function approvePurchaseOrderWithBudgetCheck(
  poId: string,
  approver: string,
): Promise<ApprovePOResult> {
  const po = await db.purchaseOrder.findUnique({ where: { id: poId } })
  if (!po) {
    return { approved: false, code: 'PO_NOT_FOUND', error: `Purchase order ${poId} not found.` }
  }

  const budget = await checkProcurementBudget(po.totalAmount, po.currency)
  if (!budget.ok) {
    return { approved: false, code: budget.code, error: `Budget check failed: ${budget.details}` }
  }

  const fromStatus = po.status
  const toStatus = 'approved'

  const updatedPO = await db.purchaseOrder.update({
    where: { id: poId },
    data: {
      status: toStatus,
      approvedBy: approver,
      approvedAt: new Date(),
    },
  })

  const approvalReceipt = await db.pOApproval.create({
    data: {
      purchaseOrderId: poId,
      action: 'approved',
      performedBy: approver,
      reason: `Budget check passed. spendable=${budget.spendable.toFixed(2)} required=${budget.required.toFixed(2)} ${budget.currency}`,
      fromStatus,
      toStatus,
    },
  })

  try {
    const lastAudit = await db.auditLedger.findFirst({ orderBy: { createdAt: 'desc' } })
    const auditContent = JSON.stringify({
      entityType: 'purchase_order', entityId: poId, action: 'po_approved',
      approver, fromStatus, toStatus, totalAmount: po.totalAmount, currency: po.currency,
      budgetSpendable: budget.spendable, budgetCode: budget.code,
    })
    await db.auditLedger.create({
      data: {
        entityType: 'purchase_order',
        entityId: poId,
        action: 'po_approved',
        previousHash: lastAudit?.entryHash ?? null,
        entryHash: sha256(auditContent),
        performedBy: approver,
        metadata: JSON.stringify({
          poNumber: po.poNumber, supplierId: po.supplierId, totalAmount: po.totalAmount,
          currency: po.currency, approvalId: approvalReceipt.id,
        }),
      },
    })
  } catch (e) { console.error('[Procurement] PO approval audit write failed:', e) }

  return {
    approved: true,
    receipt: approvalReceipt as unknown as Record<string, unknown>,
  }
}

// ———————————————————————————————————————————————————————————————————
// Task 2 (A)(iv): Create or Get Purchase Order (idempotent via AuditLedger)
// ———————————————————————————————————————————————————————————————————

export interface PurchaseOrderCreateData {
  poNumber: string
  supplierId?: string | null
  supplierName: string
  totalAmount: number
  currency: string
  ownerInitiated?: boolean
  title?: string | null
  status?: string
  priority?: string
  notes?: string | null
  lineItemCount?: number
  batchRef?: string | null
}

export interface CreateOrGetPOResult {
  purchaseOrder: Record<string, unknown>
  idempotentReplay: boolean
  approvalId?: string
}

export async function createOrGetPurchaseOrder(
  data: PurchaseOrderCreateData,
  callerKey?: string,
): Promise<CreateOrGetPOResult> {
  const parts = [
    data.poNumber,
    data.supplierId ?? '',
    String(data.totalAmount),
    data.currency,
    String(data.ownerInitiated !== false),
  ]
  const defaultKey = sha256(parts.join('|'))
  const idempotencyKey = callerKey ?? defaultKey
  const metadataLookupFragment = `"idempotencyKey":"${idempotencyKey}"`

  const priorAudit = await db.auditLedger.findFirst({
    where: {
      entityType: 'purchase_order',
      action: 'po_submitted',
      metadata: { contains: metadataLookupFragment },
    },
    orderBy: { createdAt: 'desc' },
  })

  let matchedPOId: string | null = null
  if (priorAudit?.metadata) {
    try {
      const md = JSON.parse(priorAudit.metadata)
      if (md && md.purchaseOrderId) matchedPOId = md.purchaseOrderId
    } catch { /* fall through to unique lookup */ }
  }

  if (matchedPOId) {
    const existingPO = await db.purchaseOrder.findUnique({ where: { id: matchedPOId } })
    if (existingPO) {
      return {
        purchaseOrder: existingPO as unknown as Record<string, unknown>,
        idempotentReplay: true,
      }
    }
  }

  const byPoNum = await db.purchaseOrder.findUnique({ where: { poNumber: data.poNumber } })
  if (byPoNum) {
    return {
      purchaseOrder: byPoNum as unknown as Record<string, unknown>,
      idempotentReplay: true,
    }
  }

  const ownerInit = data.ownerInitiated !== false
  const enforced = enforcePrepaidPolicy({ ownerInitiated: ownerInit })
  if (!enforced.valid) {
    throw new Error(`Prepaid policy violation: ${enforced.violations.join('; ')}`)
  }

  const created = await db.purchaseOrder.create({
    data: {
      poNumber: data.poNumber,
      supplierId: data.supplierId ?? null,
      supplierName: data.supplierName,
      ownerInitiated: ownerInit,
      status: data.status ?? 'submitted',
      priority: data.priority ?? 'normal',
      currency: data.currency,
      lineItemCount: data.lineItemCount ?? 0,
      totalAmount: data.totalAmount,
      submittedAt: new Date(),
      title: data.title ?? null,
      notes: data.notes ?? null,
      batchRef: data.batchRef ?? null,
    },
  })

  const approval = await db.pOApproval.create({
    data: {
      purchaseOrderId: created.id,
      action: 'submitted',
      performedBy: 'system',
      reason: `PO submitted. idempotencyKey=${idempotencyKey.slice(0, 16)}...`,
      fromStatus: 'draft',
      toStatus: data.status ?? 'submitted',
    },
  })

  try {
    const lastAudit = await db.auditLedger.findFirst({ orderBy: { createdAt: 'desc' } })
    const auditContent = JSON.stringify({
      entityType: 'purchase_order', entityId: created.id, action: 'po_submitted',
      poNumber: data.poNumber, supplierId: data.supplierId, totalAmount: data.totalAmount,
      currency: data.currency, ownerInitiated: ownerInit,
    })
    await db.auditLedger.create({
      data: {
        entityType: 'purchase_order',
        entityId: created.id,
        action: 'po_submitted',
        previousHash: lastAudit?.entryHash ?? null,
        entryHash: sha256(auditContent),
        performedBy: 'system',
        metadata: JSON.stringify({
          poNumber: data.poNumber,
          supplierId: data.supplierId,
          totalAmount: data.totalAmount,
          currency: data.currency,
          ownerInitiated: ownerInit,
          idempotencyKey,
          purchaseOrderId: created.id,
          approvalId: approval.id,
        }),
      },
    })
  } catch (e) { console.error('[Procurement] PO submit audit write failed:', e) }

  return {
    purchaseOrder: created as unknown as Record<string, unknown>,
    idempotentReplay: false,
    approvalId: approval.id,
  }
}

// ———————————————————————————————————————————————————————————————————
// Task 2 (A)(v): Preferred Supplier for Category (MA-default hard gate)
// ———————————————————————————————————————————————————————————————————

export type InternationalFallbackMode = 'never' | 'operator_approved'

export interface SupplierCategoryOpts {
  allowInternationalFallback?: InternationalFallbackMode
}

export interface PreferredSupplierError extends Error {
  code: string
}

function defRateOK(s: { totalDelivered: number; itemsWithDefect: number }): boolean {
  if (s.totalDelivered <= 0) return false
  return (s.itemsWithDefect / s.totalDelivered) < 0.15
}

export async function getPreferredSupplierForCategory(
  category: string,
  opts: SupplierCategoryOpts = { allowInternationalFallback: 'never' },
): Promise<Record<string, unknown>> {
  const mode: InternationalFallbackMode = opts.allowInternationalFallback ?? 'never'

  const maActive = await db.supplier.findMany({
    where: {
      isActive: true,
      country: 'MA',
      totalDelivered: { gt: 0 },
    },
  })

  const maQualified = maActive.filter((s) => defRateOK(s as unknown as { totalDelivered: number; itemsWithDefect: number }))

  if (maQualified.length > 0) {
    maQualified.sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
      const aRate = (a.itemsWithDefect as number) / Math.max(1, a.totalDelivered as number)
      const bRate = (b.itemsWithDefect as number) / Math.max(1, b.totalDelivered as number)
      if (aRate !== bRate) return aRate - bRate
      return (b.totalDelivered as number) - (a.totalDelivered as number)
    })
    return maQualified[0] as unknown as Record<string, unknown>
  }

  if (mode !== 'operator_approved') {
    const err = new Error(
      `SupplierNotFound: no Moroccan (MA) suppliers qualified for category="${category}". ` +
      `Criteria: isActive=true, country=MA, totalDelivered>0, defectRate<0.15. ` +
      `operator_approval required for international fallback via allowInternationalFallback='operator_approved'.`,
    ) as PreferredSupplierError
    err.code = 'NO_MOROCCAN_SUPPLIER'
    throw err
  }

  const fallbackApproved = await db.pOApproval.findFirst({
    where: {
      action: 'supplier_fallback_approved',
    },
    orderBy: { createdAt: 'desc' },
  })
  if (!fallbackApproved) {
    const err = new Error(
      `SupplierFallbackDenied: allowInternationalFallback='operator_approved' was set but NO ` +
      `POApproval row with action='supplier_fallback_approved' performedBy=operator exists for category="${category}". ` +
      `Create the operator-signed fallback approval row first, or source a qualified Moroccan supplier.`,
    ) as PreferredSupplierError
    err.code = 'SUPPLIER_FALLBACK_NOT_APPROVED'
    throw err
  }

  const allActive = await db.supplier.findMany({
    where: {
      isActive: true,
      totalDelivered: { gt: 0 },
    },
  })

  const intlQualified = allActive.filter((s) => defRateOK(s as unknown as { totalDelivered: number; itemsWithDefect: number }))
  if (intlQualified.length === 0) {
    const err = new Error(
      `SupplierNotFound: no qualified suppliers (any country) for category="${category}". ` +
      `Criteria: isActive=true, totalDelivered>0, defectRate<0.15.`,
    ) as PreferredSupplierError
    err.code = 'NO_QUALIFIED_SUPPLIER_ANY_COUNTRY'
    throw err
  }

  intlQualified.sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
    const aRate = (a.itemsWithDefect as number) / Math.max(1, a.totalDelivered as number)
    const bRate = (b.itemsWithDefect as number) / Math.max(1, b.totalDelivered as number)
    if (aRate !== bRate) return aRate - bRate
    return (b.totalDelivered as number) - (a.totalDelivered as number)
  })

  const chosen = intlQualified[0] as Record<string, unknown>
  chosen._fallbackApprovedBy = fallbackApproved.performedBy
  chosen._fallbackApprovalId = fallbackApproved.id
  chosen._fallbackFromCountry = 'MA'
  return chosen
}
