import { db } from '@/lib/db'

export type RealityFinding = {
  entity: string
  id: string
  status: string
  domain: 'A' | 'B'
  missingFields: string[]
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM'
  description: string
}

export type RealityScanResult = {
  findings: RealityFinding[]
  summary: {
    total: number
    critical: number
    high: number
    medium: number
    entitiesScanned: number
  }
  scanDurationMs: number
  timestamp: string
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim().length === 0)
}

/**
 * Scans all entities for status-vs-proof integrity violations.
 * Domain A = Financial Ownership. Domain B = Physical Operations.
 */
export async function runRealityScan(): Promise<RealityScanResult> {
  const start = Date.now()
  const findings: RealityFinding[] = []
  let entitiesScanned = 0

  const [procurementItems, payoutBatches, ownerSettlements, revenueEvents, ownerPayments] = await Promise.all([
    db.procurementItem.findMany({ select: { id: true, status: true, orderRef: true, supplierName: true, receiptConfirmedBy: true, receiptConfirmedAt: true, deliveryProofHash: true, purchaseOrderId: true } }),
    db.payoutBatch.findMany({ select: { id: true, status: true, providerBatchRef: true, paymentProvider: true, proofHash: true } }),
    db.ownerSettlement.findMany({ select: { id: true, status: true, externalRef: true, dataSource: true, proofHash: true, performedBy: true } }),
    db.revenueEvent.findMany({ select: { id: true, status: true, proofHash: true, proofType: true, proofVerifiedAt: true } }),
    db.ownerPayment.findMany({ select: { id: true, status: true, sourceTxRef: true } }),
  ])

  entitiesScanned = procurementItems.length + payoutBatches.length + ownerSettlements.length + revenueEvents.length + ownerPayments.length

  // ── Domain B: Physical Operations — ProcurementItem ──
  for (const p of procurementItems) {
    if (p.status === 'ordered' && isEmpty(p.orderRef)) {
      findings.push({ entity: 'ProcurementItem', id: p.id, status: p.status, domain: 'B', missingFields: ['orderRef'], severity: 'CRITICAL', description: `ProcurementItem claims 'ordered' but has no orderRef. Order was never placed with supplier.` })
    }
    if (p.status === 'ordered' && isEmpty(p.supplierName)) {
      findings.push({ entity: 'ProcurementItem', id: p.id, status: p.status, domain: 'B', missingFields: ['supplierName'], severity: 'CRITICAL', description: `ProcurementItem claims 'ordered' but has no supplierName.` })
    }
    if (p.status === 'delivered' && (isEmpty(p.receiptConfirmedBy) || p.receiptConfirmedBy === 'system' || p.receiptConfirmedBy === 'wet-run-engine')) {
      findings.push({ entity: 'ProcurementItem', id: p.id, status: p.status, domain: 'B', missingFields: ['receiptConfirmedBy'], severity: 'CRITICAL', description: `ProcurementItem claims 'delivered' but receiptConfirmedBy is '${p.receiptConfirmedBy ?? 'null'}'. A human must confirm delivery.` })
    }
    if (p.status === 'delivered' && isEmpty(p.deliveryProofHash)) {
      findings.push({ entity: 'ProcurementItem', id: p.id, status: p.status, domain: 'B', missingFields: ['deliveryProofHash'], severity: 'HIGH', description: `ProcurementItem claims 'delivered' but has no deliveryProofHash.` })
    }
    if (p.status === 'delivered' && isEmpty(p.receiptConfirmedAt)) {
      findings.push({ entity: 'ProcurementItem', id: p.id, status: p.status, domain: 'B', missingFields: ['receiptConfirmedAt'], severity: 'HIGH', description: `ProcurementItem claims 'delivered' but receiptConfirmedAt is null.` })
    }
  }

  // ── Domain A: Financial Ownership — PayoutBatch ──
  for (const b of payoutBatches) {
    if (b.status === 'submitted' && isEmpty(b.providerBatchRef)) {
      findings.push({ entity: 'PayoutBatch', id: b.id, status: b.status, domain: 'A', missingFields: ['providerBatchRef'], severity: 'CRITICAL', description: `PayoutBatch claims 'submitted' but has no providerBatchRef. No real provider was called.` })
    }
    if (b.status === 'submitted' && isEmpty(b.paymentProvider)) {
      findings.push({ entity: 'PayoutBatch', id: b.id, status: b.status, domain: 'A', missingFields: ['paymentProvider'], severity: 'CRITICAL', description: `PayoutBatch claims 'submitted' but has no paymentProvider.` })
    }
    if (b.status === 'completed' && isEmpty(b.proofHash)) {
      findings.push({ entity: 'PayoutBatch', id: b.id, status: b.status, domain: 'A', missingFields: ['proofHash'], severity: 'CRITICAL', description: `PayoutBatch claims 'completed' but has no proofHash. Settlement was never verified.` })
    }
    if (b.status === 'completed' && isEmpty(b.providerBatchRef)) {
      findings.push({ entity: 'PayoutBatch', id: b.id, status: b.status, domain: 'A', missingFields: ['providerBatchRef'], severity: 'CRITICAL', description: `PayoutBatch claims 'completed' but has no providerBatchRef.` })
    }
  }

  // ── Domain A: Financial Ownership — OwnerSettlement ──
  for (const s of ownerSettlements) {
    if (s.status === 'completed' && isEmpty(s.externalRef)) {
      findings.push({ entity: 'OwnerSettlement', id: s.id, status: s.status, domain: 'A', missingFields: ['externalRef'], severity: 'CRITICAL', description: `OwnerSettlement claims 'completed' but has no externalRef. No external tx proof exists.` })
    }
    if (s.status === 'completed' && s.dataSource === 'internal_ledger_only') {
      findings.push({ entity: 'OwnerSettlement', id: s.id, status: s.status, domain: 'A', missingFields: ['externalRef', 'proofHash'], severity: 'CRITICAL', description: `OwnerSettlement claims 'completed' but dataSource is 'internal_ledger_only'. This is a fabrication — no external movement occurred.` })
    }
    if (s.status === 'completed' && isEmpty(s.proofHash)) {
      findings.push({ entity: 'OwnerSettlement', id: s.id, status: s.status, domain: 'A', missingFields: ['proofHash'], severity: 'HIGH', description: `OwnerSettlement claims 'completed' but has no proofHash.` })
    }
    if ((s.status === 'completed' || s.status === 'processing') && s.performedBy === 'system') {
      const exists = findings.find(f => f.entity === 'OwnerSettlement' && f.id === s.id)
      if (!exists) {
        findings.push({ entity: 'OwnerSettlement', id: s.id, status: s.status, domain: 'A', missingFields: ['externalRef'], severity: 'CRITICAL', description: `OwnerSettlement ${s.status} but performedBy is 'system'. Financial events require human authorization.` })
      }
    }
  }

  // ── Domain A: Financial Ownership — RevenueEvent ──
  for (const r of revenueEvents) {
    if (r.status === 'settled' && isEmpty(r.proofHash)) {
      findings.push({ entity: 'RevenueEvent', id: r.id, status: r.status, domain: 'A', missingFields: ['proofHash'], severity: 'CRITICAL', description: `RevenueEvent claims 'settled' but has no proofHash.` })
    }
    if (r.status === 'verified' && isEmpty(r.proofType)) {
      findings.push({ entity: 'RevenueEvent', id: r.id, status: r.status, domain: 'A', missingFields: ['proofType'], severity: 'CRITICAL', description: `RevenueEvent claims 'verified' but has no proofType.` })
    }
    if (r.status === 'verified' && isEmpty(r.proofHash)) {
      findings.push({ entity: 'RevenueEvent', id: r.id, status: r.status, domain: 'A', missingFields: ['proofHash'], severity: 'CRITICAL', description: `RevenueEvent claims 'verified' but has no proofHash.` })
    }
  }

  // ── Domain A: Financial Ownership — OwnerPayment ──
  for (const op of ownerPayments) {
    if (op.status === 'completed' && isEmpty(op.sourceTxRef)) {
      findings.push({ entity: 'OwnerPayment', id: op.id, status: op.status, domain: 'A', missingFields: ['sourceTxRef'], severity: 'HIGH', description: `OwnerPayment claims 'completed' but has no sourceTxRef.` })
    }
  }

  const critical = findings.filter(f => f.severity === 'CRITICAL').length
  const high = findings.filter(f => f.severity === 'HIGH').length
  const medium = findings.filter(f => f.severity === 'MEDIUM').length

  return {
    findings,
    summary: { total: findings.length, critical, high, medium, entitiesScanned },
    scanDurationMs: Date.now() - start,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Auto-fixes CRITICAL fabrications by reverting status to last known honest state.
 * Domain A reversions require human review after auto-fix.
 */
export async function autoFixFindings(findings: RealityFinding[]): Promise<{ fixed: number; reverts: Array<{ entity: string; id: string; from: string; to: string }> }> {
  const criticals = findings.filter(f => f.severity === 'CRITICAL')
  const reverts: Array<{ entity: string; id: string; from: string; to: string }> = []
  const now = new Date()

  for (const f of criticals) {
    try {
      if (f.entity === 'ProcurementItem') {
        const item = await db.procurementItem.findUnique({ where: { id: f.id }, select: { status: true } })
        if (!item) continue
        let newStatus: string | null = null
        if (item.status === 'delivered') newStatus = 'shipped'
        else if (item.status === 'shipped') newStatus = 'ordered'
        else if (item.status === 'ordered') newStatus = 'pending'
        if (newStatus) {
          await db.procurementItem.update({ where: { id: f.id }, data: { status: newStatus } as never })
          reverts.push({ entity: 'ProcurementItem', id: f.id, from: item.status, to: newStatus })
        }
      }

      if (f.entity === 'PayoutBatch') {
        const batch = await db.payoutBatch.findUnique({ where: { id: f.id }, select: { status: true } })
        if (!batch) continue
        let newStatus: string | null = null
        if (batch.status === 'completed') newStatus = 'submitted'
        else if (batch.status === 'submitted') newStatus = 'approved'
        if (newStatus) {
          await db.payoutBatch.update({ where: { id: f.id }, data: { status: newStatus } })
          reverts.push({ entity: 'PayoutBatch', id: f.id, from: batch.status, to: newStatus })
        }
      }

      if (f.entity === 'OwnerSettlement') {
        const settlement = await db.ownerSettlement.findUnique({ where: { id: f.id }, select: { status: true } })
        if (!settlement) continue
        if (settlement.status === 'completed') {
          await db.ownerSettlement.update({ where: { id: f.id }, data: { status: 'processing' } })
          reverts.push({ entity: 'OwnerSettlement', id: f.id, from: 'completed', to: 'processing' })
        }
      }

      if (f.entity === 'RevenueEvent') {
        const event = await db.revenueEvent.findUnique({ where: { id: f.id }, select: { status: true } })
        if (!event) continue
        let newStatus: string | null = null
        if (event.status === 'settled') newStatus = 'verified'
        else if (event.status === 'verified') newStatus = 'pending'
        if (newStatus) {
          await db.revenueEvent.update({ where: { id: f.id }, data: { status: newStatus } })
          reverts.push({ entity: 'RevenueEvent', id: f.id, from: event.status, to: newStatus })
        }
      }

      if (f.entity === 'OwnerPayment') {
        const payment = await db.ownerPayment.findUnique({ where: { id: f.id }, select: { status: true } })
        if (!payment) continue
        if (payment.status === 'completed') {
          await db.ownerPayment.update({ where: { id: f.id }, data: { status: 'processing' } })
          reverts.push({ entity: 'OwnerPayment', id: f.id, from: 'completed', to: 'processing' })
        }
      }
    } catch {
      // Skip records that can't be updated (e.g., truth-guard blocks the revert)
    }
  }

  if (reverts.length > 0) {
    try {
      const lastAudit = await db.auditLedger.findFirst({ orderBy: { createdAt: 'desc' } })
      const auditContent = JSON.stringify({ action: 'reality_check_autofix', findings: reverts, timestamp: now.toISOString() })
      await db.auditLedger.create({
        data: {
          entityType: 'reality_check_autofix',
          entityId: `AUTOFIX-${now.toISOString().slice(0, 10)}-${Date.now()}`,
          action: 'reality_check_autofix',
          previousHash: lastAudit?.entryHash ?? null,
          entryHash: Buffer.from(auditContent).toString('hex').slice(0, 64),
          performedBy: 'reality-scanner',
          metadata: auditContent,
        },
      })
    } catch {
      // Audit write failed — non-critical
    }
  }

  return { fixed: reverts.length, reverts }
}
