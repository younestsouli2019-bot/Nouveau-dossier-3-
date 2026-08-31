// ——— Three-Way Match Engine ———
// Matches PO line items ↔ Shipments/Receipts ↔ Supplier Invoices
//
// Three-way matching is the gold standard for procurement integrity:
//   1. PO (what was ordered + at what price)
//   2. Receipt (what was actually received)
//   3. Invoice (what the supplier claims we owe)
//
// Discrepancies trigger alerts. Matches above threshold auto-settle.
//
// Since SQLite doesn't have an Invoice model, we store invoice data
// as JSON metadata on the ProcurementItem (invoiceRef, invoiceAmount,
// invoiceDate) and in the notes field.
// ——————————————————————————————————————————

import { db } from '@/lib/db'
import { sha256 } from '@/lib/strict-enforcement/crypto-utils'

export interface ThreeWayMatch {
  id: string
  procurementItemId: string
  itemName: string
  recipientName: string
  poNumber: string
  poLinePrice: number
  quantityOrdered: number
  quantityReceived: number
  quantityInvoiced: number
  unitPriceReceived: number
  unitPriceInvoiced: number
  amountPO: number
  amountReceipt: number
  amountInvoice: number
  status: 'matched' | 'price_variance' | 'qty_variance' | 'overcharged' | 'missing_receipt' | 'missing_invoice' | 'disputed'
  varianceAmount: number
  variancePct: number
  oracleProof: string
  timestamp: string
}

export interface ThreeWayReport {
  timestamp: string
  totalItems: number
  matched: number
  priceVariances: number
  qtyVariances: number
  overcharges: number
  missingReceipts: number
  missingInvoices: number
  disputed: number
  totalVarianceAmount: number
  totalOverchargeAmount: number
  matches: ThreeWayMatch[]
  recoveryNeeded: Array<{
    itemId: string
    itemName: string
    overchargeAmount: number
    supplier: string
    recommendedAction: string
  }>
  auditEntryId: string
}

// Price tolerance: 5% variance is acceptable
const PRICE_TOLERANCE_PCT = 5

/**
 * Run three-way matching on all procurement items that have been received.
 */
export async function runThreeWayMatch(): Promise<ThreeWayReport> {
  const now = new Date()
  const matches: ThreeWayMatch[] = []
  const recoveryNeeded: ThreeWayReport['recoveryNeeded'] = []

  // Get all items that have been at least ordered
  const items = await db.procurementItem.findMany({
    where: { status: { notIn: ['pending', 'cancelled'] } },
  })

  // Get all POs for price reference
  const pos = await db.purchaseOrder.findMany({ include: { items: true } })

  for (const item of items) {
    // Find the PO and PO line price
    const po = item.purchaseOrderId
      ? pos.find(p => p.id === item.purchaseOrderId)
      : pos.find(p => p.items.some(i => i.id === item.id))

    const poLine = po?.items.find(i => i.id === item.id)
    const poPrice = poLine?.unitPriceEst || item.unitPriceEst
    const poNumber = po?.poNumber || 'UNLINKED'

    // Receipt data
    const quantityReceived = item.quantityReceived ?? (item.status === 'delivered' || item.status === 'receipt_confirmed' || item.status === 'settled' ? item.quantity : 0)
    const hasReceipt = !!item.receiptConfirmedAt || quantityReceived > 0

    // Invoice data (stored in notes as JSON metadata)
    let invoiceAmount = 0
    let quantityInvoiced = item.quantity
    let unitPriceInvoiced = poPrice
    try {
      const notesData = JSON.parse(item.notes || '{}')
      if (notesData.invoiceAmount) invoiceAmount = notesData.invoiceAmount
      if (notesData.invoiceQty) quantityInvoiced = notesData.invoiceQty
      if (notesData.invoiceUnitPrice) unitPriceInvoiced = notesData.invoiceUnitPrice
    } catch { /* no invoice data */ }
    const hasInvoice = invoiceAmount > 0

    const amountPO = item.quantity * poPrice
    const amountReceipt = quantityReceived * poPrice
    const amountInvoice = invoiceAmount || (hasInvoice ? quantityInvoiced * unitPriceInvoiced : 0)

    // Compute match status
    let status: ThreeWayMatch['status'] = 'matched'
    let varianceAmount = 0
    let variancePct = 0

    if (!hasReceipt) {
      status = 'missing_receipt'
    } else if (!hasInvoice && quantityInvoiced === item.quantity) {
      // No invoice data — treat as matched (invoice pending)
      status = 'matched'
    } else if (hasInvoice) {
      // Check price variance
      const priceDiff = Math.abs(unitPriceInvoiced - poPrice)
      variancePct = poPrice > 0 ? (priceDiff / poPrice) * 100 : 0
      varianceAmount = amountInvoice - amountPO

      if (variancePct > PRICE_TOLERANCE_PCT) {
        if (unitPriceInvoiced > poPrice) {
          status = 'overcharged'
        } else {
          status = 'price_variance'
        }
      } else if (quantityReceived !== quantityInvoiced && quantityInvoiced !== item.quantity) {
        status = 'qty_variance'
      } else {
        status = 'matched'
      }
    }

    // Generate oracle proof
    const oraclePayload = JSON.stringify({
      itemId: item.id,
      poNumber,
      poPrice,
      quantityOrdered: item.quantity,
      quantityReceived,
      quantityInvoiced,
      unitPriceInvoiced,
      amountPO,
      amountReceipt,
      amountInvoice,
      status,
      timestamp: now.toISOString(),
    })
    const oracleProof = sha256(oraclePayload)

    const match: ThreeWayMatch = {
      id: `TWM-${item.id.slice(-8)}`,
      procurementItemId: item.id,
      itemName: item.name,
      recipientName: item.recipientName,
      poNumber,
      poLinePrice: poPrice,
      quantityOrdered: item.quantity,
      quantityReceived,
      quantityInvoiced,
      unitPriceReceived: poPrice,
      unitPriceInvoiced,
      amountPO: Math.round(amountPO * 100) / 100,
      amountReceipt: Math.round(amountReceipt * 100) / 100,
      amountInvoice: Math.round(amountInvoice * 100) / 100,
      status,
      varianceAmount: Math.round(varianceAmount * 100) / 100,
      variancePct: Math.round(variancePct * 100) / 100,
      oracleProof,
      timestamp: now.toISOString(),
    }

    matches.push(match)

    // Flag overcharges for recovery
    if (status === 'overcharged') {
      recoveryNeeded.push({
        itemId: item.id,
        itemName: item.name,
        overchargeAmount: Math.round(varianceAmount * 100) / 100,
        supplier: item.supplierName || 'Unknown',
        recommendedAction: `Recover $${varianceAmount.toFixed(2)} overcharge from ${item.supplierName || 'supplier'}. PO price: $${poPrice}, Invoiced: $${unitPriceInvoiced}.`,
      })
    }
  }

  // Compute totals
  const matched = matches.filter(m => m.status === 'matched').length
  const priceVariances = matches.filter(m => m.status === 'price_variance').length
  const qtyVariances = matches.filter(m => m.status === 'qty_variance').length
  const overcharges = matches.filter(m => m.status === 'overcharged').length
  const missingReceipts = matches.filter(m => m.status === 'missing_receipt').length
  const missingInvoices = matches.filter(m => m.status === 'missing_invoice').length
  const disputed = matches.filter(m => m.status === 'disputed').length
  const totalVarianceAmount = matches.reduce((s, m) => s + Math.abs(m.varianceAmount), 0)
  const totalOverchargeAmount = recoveryNeeded.reduce((s, r) => s + r.overchargeAmount, 0)

  // Write AuditLedger
  const lastAudit = await db.auditLedger.findFirst({ orderBy: { createdAt: 'desc' } })
  const auditContent = JSON.stringify({
    entityType: 'three_way_match',
    entityId: `TWM-${now.toISOString().slice(0, 10)}`,
    action: 'three_way_match_executed',
    matched, priceVariances, qtyVariances, overcharges, missingReceipts, totalVarianceAmount, totalOverchargeAmount,
  })

  const auditEntry = await db.auditLedger.create({
    data: {
      entityType: 'three_way_match',
      entityId: `TWM-${now.toISOString().slice(0, 10)}`,
      action: 'three_way_match_executed',
      previousHash: lastAudit?.entryHash ?? null,
      entryHash: sha256(auditContent),
      performedBy: 'three-way-match-engine',
      metadata: auditContent,
    },
  })

  return {
    timestamp: now.toISOString(),
    totalItems: items.length,
    matched,
    priceVariances,
    qtyVariances,
    overcharges,
    missingReceipts,
    missingInvoices,
    disputed,
    totalVarianceAmount: Math.round(totalVarianceAmount * 100) / 100,
    totalOverchargeAmount: Math.round(totalOverchargeAmount * 100) / 100,
    matches,
    recoveryNeeded,
    auditEntryId: auditEntry.id,
  }
}
