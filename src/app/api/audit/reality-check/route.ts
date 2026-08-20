import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

type Violation = {
  entity: string
  id: string
  status: string
  missingFields: string[]
  severity: 'critical' | 'warning'
}

const PROCUREMENT_STATUS_ORDER = ['pending', 'ordered', 'shipped', 'delivered']

function atOrAbove(current: string, target: string): boolean {
  return PROCUREMENT_STATUS_ORDER.indexOf(current) >= PROCUREMENT_STATUS_ORDER.indexOf(target)
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim().length === 0)
}

export async function GET() {
  const violations: Violation[] = []
  let entitiesScanned = 0

  const [procurementItems, payoutBatches, ownerSettlements, revenueEvents] = await Promise.all([
    db.procurementItem.findMany(),
    db.payoutBatch.findMany(),
    db.ownerSettlement.findMany(),
    db.revenueEvent.findMany(),
  ])

  entitiesScanned = procurementItems.length + payoutBatches.length + ownerSettlements.length + revenueEvents.length

  for (const p of procurementItems) {
    if (atOrAbove(p.status, 'ordered') && isEmpty(p.orderRef)) {
      violations.push({ entity: 'ProcurementItem', id: p.id, status: p.status, missingFields: ['orderRef'], severity: 'critical' })
    }
    if (atOrAbove(p.status, 'shipped') && isEmpty(p.trackingNumber)) {
      const shipment = await (db as unknown as { shipment: { findFirst: (args: { where: { procurementItemId: string } }) => Promise<{ trackingNumber?: string | null; carrier?: string | null } | null> } }).shipment.findFirst({ where: { procurementItemId: p.id } })
      const missing: string[] = []
      if (!shipment || isEmpty(shipment.trackingNumber)) missing.push('trackingNumber')
      if (!shipment || isEmpty(shipment.carrier)) missing.push('carrier')
      if (missing.length > 0) {
        violations.push({ entity: 'ProcurementItem', id: p.id, status: p.status, missingFields: missing, severity: 'critical' })
      }
    }
    if (p.status === 'delivered' && isEmpty(p.receiptConfirmedBy)) {
      violations.push({ entity: 'ProcurementItem', id: p.id, status: p.status, missingFields: ['receiptConfirmedBy'], severity: 'warning' })
    }
  }

  for (const b of payoutBatches) {
    if (atOrAbove(b.status, 'submitted') && isEmpty(b.providerBatchRef)) {
      const missing: string[] = ['providerBatchRef']
      if (isEmpty(b.paymentProvider)) missing.push('paymentProvider')
      violations.push({ entity: 'PayoutBatch', id: b.id, status: b.status, missingFields: missing, severity: 'critical' })
    }
    if (b.status === 'completed' && isEmpty(b.proofHash)) {
      violations.push({ entity: 'PayoutBatch', id: b.id, status: b.status, missingFields: ['proofHash'], severity: 'critical' })
    }
  }

  for (const s of ownerSettlements) {
    if (s.status === 'completed' && isEmpty(s.externalRef)) {
      const missing: string[] = ['externalRef']
      if (isEmpty(s.proofHash)) missing.push('proofHash')
      violations.push({ entity: 'OwnerSettlement', id: s.id, status: s.status, missingFields: missing, severity: 'critical' })
    }
    if (s.performedBy === 'system' && (s.status === 'completed' || s.status === 'processing')) {
      const existing = violations.find(v => v.entity === 'OwnerSettlement' && v.id === s.id)
      if (!existing) {
        violations.push({ entity: 'OwnerSettlement', id: s.id, status: s.status, missingFields: ['externalRef'], severity: 'critical' })
      }
    }
  }

  for (const r of revenueEvents) {
    if (r.status === 'settled' && isEmpty(r.proofHash)) {
      const missing: string[] = ['proofHash']
      if (isEmpty(r.proofType)) missing.push('proofType')
      if (isEmpty(r.proofVerifiedAt)) missing.push('proofVerifiedAt')
      violations.push({ entity: 'RevenueEvent', id: r.id, status: r.status, missingFields: missing, severity: 'critical' })
    }
  }

  const critical = violations.filter(v => v.severity === 'critical').length
  const warning = violations.filter(v => v.severity === 'warning').length

  return NextResponse.json({
    violations,
    summary: {
      total: violations.length,
      critical,
      warning,
      entitiesScanned,
    },
    timestamp: new Date().toISOString(),
  })
}
