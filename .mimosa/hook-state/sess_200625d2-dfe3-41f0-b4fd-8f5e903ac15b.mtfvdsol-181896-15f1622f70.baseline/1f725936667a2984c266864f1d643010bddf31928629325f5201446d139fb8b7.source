// ——— Audit & Ledger Reconciliation Engine (RWC Patched) ———
// Full ledger reconciliation: revenue vs settlements vs payouts.
// Creates chained AuditLedger entries and LedgerSnapshots.
// ———————————————————————————————————————————————————————————

import { db } from '@/lib/db'
import { sha256 } from './crypto-utils'

export interface ReconciliationReport {
  timestamp: string
  integrityStatus: 'clean' | 'discrepancies_found' | 'critical_violations'
  balanceDelta: number
  transactionsBlocked: boolean
  summary: {
    totalRevenue: number
    totalSettled: number
    totalPending: number
    totalRejected: number
    totalFailedReversed: number
    revenueEvents: number
    settlements: number
    payoutBatches: number
    procurementItems: number
    settlementViolations: number
    fictionalSettlements: number
    unverifiedRevenue: number
    procurementDiscrepancies: number
  }
  violations: Array<{
    type: string
    entity: string
    entityId: string
    rule: string
    description: string
    severity: 'critical' | 'warning' | 'info'
  }>
  snapshotId?: string
}

/**
 * Run full audit and reconciliation.
 * Compares revenue → settlements → payouts for integrity.
 */
export async function runFullReconciliation(): Promise<ReconciliationReport> {
  const violations: ReconciliationReport['violations'] = []

  // 1. Revenue audit
  const allRevenue = await db.revenueEvent.findMany()
  const totalRevenue = allRevenue.filter(r => r.status !== 'rejected').reduce((s, r) => s + r.amount, 0)
  const totalRejected = allRevenue.filter(r => r.status === 'rejected').reduce((s, r) => s + r.amount, 0)
  const unverifiedRevenue = allRevenue.filter(r => r.status === 'pending' || (r.status === 'verified' && !r.proofHash))

  for (const r of unverifiedRevenue) {
    violations.push({
      type: 'unverified_revenue', entity: 'RevenueEvent', entityId: r.id,
      rule: 'RWC-STRICT-010',
      description: `Revenue $${r.amount} from '${r.source}' has status '${r.status}' but ${!r.proofType ? 'no proofType' : 'no proofHash'}.`,
      severity: r.amount > 1000 ? 'critical' : 'warning',
    })
  }

  // 2. Settlement audit
  const allSettlements = await db.ownerSettlement.findMany()
  const completedSettlements = allSettlements.filter(s => s.status === 'completed')
  const totalSettled = completedSettlements.reduce((s, x) => s + x.amount, 0)
  const pendingSettlements = allSettlements.filter(s => s.status === 'pending' || s.status === 'processing')
  const totalPending = pendingSettlements.reduce((s, x) => s + x.amount, 0)
  const failedReversedSettlements = allSettlements.filter(s => s.status === 'failed' || s.status === 'reversed')
  const totalFailedReversed = failedReversedSettlements.reduce((s, x) => s + x.amount, 0)

  // CRITICAL: Find completed settlements without externalRef
  const settlementViolations = allSettlements.filter(s =>
    s.status === 'completed' && (!s.externalRef || s.externalRef.length < 6)
  )
  for (const s of settlementViolations) {
    violations.push({
      type: 'settlement_without_external_ref', entity: 'OwnerSettlement', entityId: s.id,
      rule: 'RWC-STRICT-001',
      description: `Settlement $${s.amount} marked 'completed' without valid externalRef. dataSource: ${s.dataSource}.`,
      severity: 'critical',
    })
  }

  // Find fictional settlements (completed but internal_ledger_only)
  const fictionalSettlements = completedSettlements.filter(s => s.dataSource === 'internal_ledger_only')
  for (const s of fictionalSettlements) {
    violations.push({
      type: 'fictional_settlement', entity: 'OwnerSettlement', entityId: s.id,
      rule: 'RWC-STRICT-004',
      description: `Settlement $${s.amount} marked 'completed' with dataSource='internal_ledger_only'. This settlement NEVER touched a real financial system.`,
      severity: 'critical',
    })
  }

  // 3. Payout batch audit
  const allBatches = await db.payoutBatch.findMany()

  // 4. Procurement audit
  const allProcurement = await db.procurementItem.findMany()
  let procurementDiscrepancies = 0
  for (const p of allProcurement) {
    if (p.status === 'delivered' && (p as Record<string, unknown>).quantityReceived !== undefined) {
      const qtyReceived = (p as Record<string, unknown>).quantityReceived as number
      if (qtyReceived !== null && qtyReceived !== p.quantity) {
        procurementDiscrepancies++
        violations.push({
          type: 'procurement_qty_mismatch', entity: 'ProcurementItem', entityId: p.id,
          rule: 'RWC-PROC-001',
          description: `Item '${p.name}' ordered ${p.quantity} but received ${qtyReceived}. Discrepancy!`,
          severity: qtyReceived < p.quantity ? 'warning' : 'info',
        })
      }
    }
    // Delivered but no receipt confirmation
    if (p.status === 'delivered' && !(p as Record<string, unknown>).receiptConfirmedAt) {
      violations.push({
        type: 'delivery_without_receipt', entity: 'ProcurementItem', entityId: p.id,
        rule: 'RWC-PROC-002',
        description: `Item '${p.name}' marked delivered but receipt NOT confirmed separately.`,
        severity: 'warning',
      })
    }
  }

  // Determine overall integrity status
  const criticalCount = violations.filter(v => v.severity === 'critical').length
  const integrityStatus = criticalCount === 0
    ? (violations.length === 0 ? 'clean' : 'discrepancies_found')
    : 'critical_violations'

  // TRUTH-RECONCILE: Compute balance delta — block all new settlements if ≠ 0
  // Formula: Revenue - Settled - Pending - Failed/Reversed = Delta
  // Failed/reversed settlements are subtracted because they never completed,
  // so their amounts shouldn't block future settlements.
  const balanceDelta = Math.round((totalRevenue - totalSettled - totalPending - totalFailedReversed) * 100) / 100
  const transactionsBlocked = balanceDelta !== 0

  if (transactionsBlocked) {
    violations.push({
      type: 'balance_delta_nonzero',
      entity: 'Reconciliation',
      entityId: 'BALANCE_CHECK',
      rule: 'TRUTH-RECONCILE-001',
      description: `Balance delta $${balanceDelta}: Revenue $${totalRevenue} ≠ Settled $${totalSettled} + Pending $${totalPending}. ALL new settlements BLOCKED until delta = 0.`,
      severity: 'critical',
    })
  }

  const report: ReconciliationReport = {
    timestamp: new Date().toISOString(),
    integrityStatus: transactionsBlocked ? 'critical_violations' : integrityStatus,
    balanceDelta,
    transactionsBlocked,
    summary: {
      totalRevenue, totalSettled, totalPending, totalRejected, totalFailedReversed,
      revenueEvents: allRevenue.length,
      settlements: allSettlements.length,
      payoutBatches: allBatches.length,
      procurementItems: allProcurement.length,
      settlementViolations: settlementViolations.length,
      fictionalSettlements: fictionalSettlements.length,
      unverifiedRevenue: unverifiedRevenue.length,
      procurementDiscrepancies,
    },
    violations,
  }

  // 5. Save LedgerSnapshot
  try {
    const snapshotContent = JSON.stringify({
      totalRevenue, totalSettled, totalPending, totalRejected,
      revenueEvents: allRevenue.length, settlements: allSettlements.length,
      payoutBatches: allBatches.length, procurementItems: allProcurement.length,
      integrityStatus, violationsCount: violations.length,
    })
    const previousSnapshot = await db.ledgerSnapshot.findFirst({
      where: { snapshotType: 'post_reconciliation' },
      orderBy: { createdAt: 'desc' },
    })
    const snapshot = await db.ledgerSnapshot.create({
      data: {
        snapshotType: 'post_reconciliation',
      totalRevenue, totalSettled, totalPending, totalRejected,
        settlementCount: allSettlements.length,
        revenueCount: allRevenue.length,
        discrepancyCount: violations.length,
        integrityHash: sha256(snapshotContent),
        previousSnapshotId: previousSnapshot?.id ?? null,
        metadata: JSON.stringify(report),
      },
    })
    report.snapshotId = snapshot.id
  } catch (e) {
    console.error('[Reconciliation] LedgerSnapshot save failed:', e)
  }

  return report
}

/**
 * Get the audit ledger chain (last N entries).
 */
export async function getAuditChain(limit = 50) {
  return db.auditLedger.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}

/**
 * Verify audit chain integrity (each entry's previousHash matches the prior entry's entryHash).
 */
export async function verifyAuditChainIntegrity() {
  const entries = await db.auditLedger.findMany({
    orderBy: { createdAt: 'asc' },
  })

  let chainBroken = false
  let brokenAtIndex = -1
  let brokenReason = ''

  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1]
    const curr = entries[i]
    if (curr.previousHash !== prev.entryHash) {
      chainBroken = true
      brokenAtIndex = i
      brokenReason = `Entry ${curr.id} previousHash (${curr.previousHash?.slice(0, 12)}...) != prior entryHash (${prev.entryHash?.slice(0, 12)}...)`
      break
    }
  }

  return {
    totalEntries: entries.length,
    chainIntact: !chainBroken,
    brokenAtIndex,
    brokenReason,
    firstEntryId: entries[0]?.id ?? null,
    lastEntryId: entries[entries.length - 1]?.id ?? null,
  }
}

/**
 * Get ledger snapshots (for timeline view).
 */
export async function getLedgerSnapshots(limit = 20) {
  return db.ledgerSnapshot.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}