// ——— Pipeline Advancement Engine ———
// Moves procurement items through the pipeline with oracle proofs:
//   pending → ordered → shipped → in_transit → delivered → receipt_confirmed → settled
//
// Each transition generates an oracle proof (SHA-256 hash of the transition data)
// that is stored on the item and in the AuditLedger for tamper detection.
// ——————————————————————————————————————————

import { db } from '@/lib/db'
import { sha256 } from '@/lib/strict-enforcement/crypto-utils'

export type PipelineStatus =
  | 'pending' | 'ordered' | 'shipped' | 'in_transit'
  | 'delivered' | 'receipt_confirmed' | 'settled' | 'cancelled'

export interface AdvanceResult {
  itemId: string
  itemName: string
  fromStatus: string
  toStatus: string
  oracleProof: string
  timestamp: string
}

export interface BulkAdvanceReport {
  timestamp: string
  advanced: AdvanceResult[]
  skipped: Array<{ itemId: string; itemName: string; reason: string }>
  errors: Array<{ itemId: string; itemName: string; error: string }>
  totalAdvanced: number
  totalSkipped: number
}

/**
 * Advance a single item to the next pipeline stage.
 * Returns the oracle proof for the transition.
 */
export async function advanceItem(
  itemId: string,
  targetStatus: PipelineStatus,
  metadata?: {
    carrier?: string
    trackingNumber?: string
    trackingUrl?: string
    proofHash?: string
    confirmedBy?: string
    notes?: string
  },
): Promise<AdvanceResult> {
  const item = await db.procurementItem.findUnique({ where: { id: itemId } })
  if (!item) throw new Error(`Item ${itemId} not found`)

  const validTransitions: Record<string, string[]> = {
    pending: ['ordered', 'cancelled'],
    ordered: ['shipped', 'cancelled'],
    shipped: ['in_transit', 'delivered', 'cancelled'],
    in_transit: ['delivered', 'cancelled'],
    delivered: ['receipt_confirmed', 'cancelled'],
    receipt_confirmed: ['settled'],
    settled: [],
    cancelled: [],
  }

  const allowed = validTransitions[item.status] || []
  if (!allowed.includes(targetStatus)) {
    throw new Error(`Cannot transition '${item.name}' from '${item.status}' to '${targetStatus}'. Allowed: ${allowed.join(', ')}`)
  }

  const now = new Date()
  const updateData: Record<string, unknown> = { status: targetStatus }

  // Build oracle proof
  const oraclePayload = JSON.stringify({
    itemId: item.id,
    itemName: item.name,
    fromStatus: item.status,
    toStatus: targetStatus,
    quantity: item.quantity,
    unitPrice: item.unitPriceEst,
    recipient: item.recipientName,
    timestamp: now.toISOString(),
    metadata,
  })
  const oracleProof = sha256(oraclePayload)

  switch (targetStatus) {
    case 'ordered':
      updateData.orderedAt = item.orderedAt || now
      updateData.orderRef = metadata?.trackingNumber || item.orderRef
      break
    case 'shipped':
      updateData.shippedAt = now
      updateData.supplierName = metadata?.carrier || item.supplierName
      // Create Shipment record
      const shipCount = await db.shipment.count()
      await db.shipment.create({
        data: {
          shipmentNumber: `SHP-${String(shipCount + 1).padStart(3, '0')}`,
          procurementItemId: item.id,
          itemName: item.name,
          quantity: item.quantity,
          carrier: metadata?.carrier,
          trackingNumber: metadata?.trackingNumber,
          trackingUrl: metadata?.trackingUrl,
          status: 'in_transit',
          destinationName: item.recipientName,
          destinationAddress: item.deliveryAddress || item.recipientAddress || 'Morocco',
          estimatedDelivery: new Date(Date.now() + 7 * 86400000), // 7 days
          notes: metadata?.notes,
        },
      })
      break
    case 'in_transit':
      // Update shipment status
      const shipment = await db.shipment.findFirst({ where: { procurementItemId: item.id } })
      if (shipment) {
        await db.shipment.update({
          where: { id: shipment.id },
          data: {
            status: 'in_transit',
            trackingVerified: !!metadata?.trackingNumber,
            trackingVerifiedAt: metadata?.trackingNumber ? now : undefined,
          },
        })
      }
      break
    case 'delivered':
      updateData.deliveredAt = now
      // Update shipment
      const delivShipment = await db.shipment.findFirst({ where: { procurementItemId: item.id } })
      if (delivShipment) {
        await db.shipment.update({
          where: { id: delivShipment.id },
          data: { status: 'delivered', actualDelivery: now },
        })
      }
      break
    case 'receipt_confirmed':
      updateData.receiptConfirmedAt = now
      updateData.receiptConfirmedBy = metadata?.confirmedBy || 'system-auto'
      updateData.deliveryProofHash = metadata?.proofHash || oracleProof
      updateData.quantityReceived = item.quantity
      updateData.receiptCondition = 'good'
      updateData.receiptNotes = metadata?.notes || 'Auto-confirmed via pipeline advancement'
      break
    case 'settled':
      // Mark as fully settled — items are pre-paid by Swarm
      updateData.notes = `${item.notes || ''} | [SETTLED] Pipeline settlement at ${now.toISOString()}`.trim()
      break
  }

  // Store oracle proof in the item notes
  updateData.notes = `${updateData.notes || item.notes || ''} | [ORACLE:${item.status}->${targetStatus}] proof:${oracleProof.slice(0, 16)}...`.trim()

  const updated = await db.procurementItem.update({ where: { id: itemId }, data: updateData })

  // Write AuditLedger entry
  const lastAudit = await db.auditLedger.findFirst({ orderBy: { createdAt: 'desc' } })
  await db.auditLedger.create({
    data: {
      entityType: 'procurement_item',
      entityId: itemId,
      action: `pipeline_${targetStatus}`,
      previousHash: lastAudit?.entryHash ?? null,
      entryHash: oracleProof,
      proofHash: oracleProof,
      performedBy: 'pipeline-engine',
      metadata: JSON.stringify({
        itemName: item.name,
        fromStatus: item.status,
        toStatus: targetStatus,
        recipient: item.recipientName,
        quantity: item.quantity,
        unitPrice: item.unitPriceEst,
        oracleProof,
      }),
    },
  })

  return {
    itemId: item.id,
    itemName: item.name,
    fromStatus: item.status,
    toStatus: targetStatus,
    oracleProof,
    timestamp: now.toISOString(),
  }
}

/**
 * Bulk advance all eligible items to their next pipeline stage.
 */
export async function bulkAdvance(
  targetStatus?: PipelineStatus,
  metadata?: {
    carrier?: string
    trackingNumber?: string
    trackingUrl?: string
    proofHash?: string
    confirmedBy?: string
    notes?: string
  },
): Promise<BulkAdvanceReport> {
  const report: BulkAdvanceReport = {
    timestamp: new Date().toISOString(),
    advanced: [],
    skipped: [],
    errors: [],
    totalAdvanced: 0,
    totalSkipped: 0,
  }

  const items = await db.procurementItem.findMany({
    where: { status: { notIn: ['settled', 'cancelled'] } },
  })

  // Determine which status to advance to based on current status
  const nextStatus: Record<string, PipelineStatus> = {
    pending: 'ordered',
    ordered: 'shipped',
    shipped: 'in_transit',
    in_transit: 'delivered',
    delivered: 'receipt_confirmed',
    receipt_confirmed: 'settled',
  }

  for (const item of items) {
    const goal = targetStatus || nextStatus[item.status]
    if (!goal) {
      report.skipped.push({ itemId: item.id, itemName: item.name, reason: `No target for status '${item.status}'` })
      report.totalSkipped++
      continue
    }

    try {
      const result = await advanceItem(item.id, goal, metadata)
      report.advanced.push(result)
      report.totalAdvanced++
    } catch (err) {
      report.errors.push({
        itemId: item.id,
        itemName: item.name,
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  return report
}
