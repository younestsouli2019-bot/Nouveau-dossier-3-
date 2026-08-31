import { db } from '@/lib/db'

export type ProofRequirement = {
  entity: string
  status: string
  requiredFields: string[]
  severity: 'critical' | 'warning'
}

export type BlockReason = {
  entity: string
  entityId: string
  attemptedStatus: string
  missingFields: string[]
  severity: 'critical' | 'warning'
}

const STATUS_ORDER: Record<string, string[]> = {
  ProcurementItem: ['pending', 'ordered', 'shipped', 'delivered'],
  PayoutBatch: ['pending_approval', 'approved', 'submitted', 'completed'],
  OwnerSettlement: ['pending', 'processing', 'completed', 'failed', 'reversed'],
  RevenueEvent: ['pending', 'verified', 'settled', 'rejected'],
}

export const STATUS_PROOF_MAP: ProofRequirement[] = [
  { entity: 'ProcurementItem', status: 'ordered', requiredFields: ['orderRef', 'supplierName'], severity: 'critical' },
  { entity: 'ProcurementItem', status: 'shipped', requiredFields: ['trackingNumber', 'carrier'], severity: 'critical' },
  { entity: 'ProcurementItem', status: 'delivered', requiredFields: ['receiptConfirmedBy', 'receiptConfirmedAt'], severity: 'critical' },

  { entity: 'PayoutBatch', status: 'submitted', requiredFields: ['providerBatchRef', 'paymentProvider'], severity: 'critical' },
  { entity: 'PayoutBatch', status: 'completed', requiredFields: ['proofHash', 'providerBatchRef'], severity: 'critical' },

  { entity: 'OwnerSettlement', status: 'completed', requiredFields: ['externalRef', 'proofHash'], severity: 'critical' },
  { entity: 'OwnerSettlement', status: 'processing', requiredFields: ['connectorId', 'connectorStatus'], severity: 'warning' },

  { entity: 'RevenueEvent', status: 'settled', requiredFields: ['proofHash', 'proofType', 'proofVerifiedAt'], severity: 'critical' },
]

function statusAtOrAbove(entity: string, current: string, target: string): boolean {
  const order = STATUS_ORDER[entity]
  if (!order) return current === target
  return order.indexOf(current) >= order.indexOf(target)
}

function getField(record: Record<string, unknown>, field: string): unknown {
  return record[field]
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string' && value.trim().length === 0) return true
  return false
}

export async function validateProofChain(
  entity: string,
  recordId: string,
  attemptedStatus: string,
): Promise<BlockReason | null> {
  const record = await fetchRecord(entity, recordId)
  if (!record) return null

  const requirements = STATUS_PROOF_MAP.filter(
    r => r.entity === entity && statusAtOrAbove(entity, attemptedStatus, r.status),
  )

  const missingFields: string[] = []
  let worstSeverity: 'critical' | 'warning' = 'warning'

  for (const req of requirements) {
    for (const field of req.requiredFields) {
      if (field === 'trackingNumber' || field === 'carrier') {
        const shipment = await fetchShipmentForProcurement(recordId)
        if (shipment) {
          if (field === 'trackingNumber' && isEmpty(getField(shipment as Record<string, unknown>, 'trackingNumber'))) {
            missingFields.push(field)
          }
          if (field === 'carrier' && isEmpty(getField(shipment as Record<string, unknown>, 'carrier'))) {
            missingFields.push(field)
          }
          continue
        }
      }

      if (isEmpty(getField(record as Record<string, unknown>, field))) {
        missingFields.push(field)
      }
    }
    if (req.severity === 'critical') worstSeverity = 'critical'
  }

  if (missingFields.length === 0) return null

  return {
    entity,
    entityId: recordId,
    attemptedStatus,
    missingFields: [...new Set(missingFields)],
    severity: worstSeverity,
  }
}

async function fetchRecord(entity: string, id: string) {
  switch (entity) {
    case 'ProcurementItem':
      return db.procurementItem.findUnique({ where: { id } })
    case 'PayoutBatch':
      return db.payoutBatch.findUnique({ where: { id } })
    case 'OwnerSettlement':
      return db.ownerSettlement.findUnique({ where: { id } })
    case 'RevenueEvent':
      return db.revenueEvent.findUnique({ where: { id } })
    default:
      return null
  }
}

async function fetchShipmentForProcurement(procurementItemId: string) {
  try {
    const shipment = await (db as unknown as { shipment: { findFirst: (args: { where: { procurementItemId: string } }) => Promise<Record<string, unknown> | null> } }).shipment.findFirst({ where: { procurementItemId } })
    return shipment ?? null
  } catch {
    return null
  }
}
