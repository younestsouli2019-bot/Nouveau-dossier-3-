// ——— Rectifier (SCSS) ———
// Drift detection + safe auto-remediation. Compares the current state
// against the last synchronized snapshot and hot-patches ONLY issues that
// are provably safe (missing timestamps, orphaned log links). Anything that
// touches money or proof integrity is escalated, never auto-fixed.

import { db } from '@/lib/db'
import { sha256 } from '@/lib/strict-enforcement/crypto-utils'
import { findCompletedWithoutExternalRef } from '@/lib/strict-enforcement/strict-settlement'
import { findUnverifiedRevenue } from '@/lib/strict-enforcement/strict-revenue'
import { rememberIncident, recordRemedy, applyLearnedRemedy } from '@/lib/swarm/memory'
import type { SwarmSeverity } from '@/lib/swarm/memory'
import { snapshotState, computeStateSummary } from './synchronizer'
import type { AgentRun, AgentStepResult, Finding } from './types'

async function time<T>(fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
  const start = Date.now()
  const result = await fn()
  return { result, durationMs: Date.now() - start }
}

async function audit(entityType: string, entityId: string, action: string, detail: string) {
  const lastAudit = await db.auditLedger.findFirst({ orderBy: { createdAt: 'desc' } })
  await db.auditLedger.create({
    data: {
      entityType,
      entityId,
      action,
      previousHash: lastAudit?.entryHash ?? null,
      entryHash: sha256(JSON.stringify({ entityType, entityId, action, detail })),
      performedBy: 'agentic-rectifier',
      metadata: JSON.stringify({ detail }),
    },
  })
}

/**
 * Detect drift between the latest two synchronized snapshots.
 * Returns a human-readable diff plus a drift hash.
 */
export async function detectDrift() {
  const snapshots = await db.ledgerSnapshot.findMany({
    orderBy: { createdAt: 'desc' },
    take: 2,
  })
  if (snapshots.length < 2) {
    return { hasPrevious: false, driftDetected: false, driftHash: null, diff: 'Only one or zero snapshots — baseline not established' }
  }
  const [latest, previous] = snapshots
  const fields: Array<keyof typeof latest> = [
    'totalRevenue', 'totalSettled', 'totalPending', 'totalRejected',
    'settlementCount', 'revenueCount', 'discrepancyCount',
  ]
  const diff = fields
    .map((f) => `${f}: ${previous[f]} → ${latest[f]}`)
    .filter((line) => !line.includes('=='))
    .join(', ') || 'no field-level drift'
  const driftDetected = latest.integrityHash !== previous.integrityHash
  return {
    hasPrevious: true,
    driftDetected,
    driftHash: latest.integrityHash,
    diff,
  }
}

// Stable messages so learning (rememberIncident / applyLearnedRemedy) always
// resolves to the same fingerprint per drift pattern.
const STALE_PROCESSEDAT_CODE = 'RECTIFY-STALE-PROCESSEDAT'
const STALE_PROCESSEDAT_MSG = 'completed payout items missing processedAt'
const ORPHAN_LOG_CODE = 'RECTIFY-ORPHAN-LOG'
const ORPHAN_LOG_MSG = 'transaction logs unlinked to payout items'

async function backfillProcessedAt(): Promise<number> {
  const staleCompleted = await db.payoutItem.findMany({
    where: { status: 'completed', processedAt: null },
  })
  for (const item of staleCompleted) {
    await db.payoutItem.update({
      where: { id: item.id },
      data: { processedAt: item.updatedAt ?? new Date() },
    })
    await audit('payout_item', item.id, 'rectify_timestamp', 'backfilled processedAt')
  }
  return staleCompleted.length
}

async function linkOrphanLogs(): Promise<number> {
  const unlinkedLogs = await db.transactionLog.findMany({
    where: { payoutItemId: null },
  })
  let patched = 0
  for (const log of unlinkedLogs) {
    const match = await db.payoutItem.findFirst({
      where: {
        OR: [
          { transactionRef: log.referenceId },
          { transactionRef: log.providerTxId },
        ],
      },
    })
    if (match) {
      await db.transactionLog.update({
        where: { id: log.id },
        data: { payoutItemId: match.id, payoutBatchId: log.payoutBatchId ?? match.payoutBatchId },
      })
      await audit('transaction_log', log.id, 'rectify_link_orphan', `linked to payout_item ${match.id}`)
      patched++
    }
  }
  return patched
}

/**
 * Auto-remediate safe drift. Returns counts of items patched.
 * Only no-money-movement fixes run automatically.
 */
export async function remedySafeDrift(): Promise<{ patched: number; details: string[] }> {
  const details: string[] = []

  const backfilled = await backfillProcessedAt()
  if (backfilled > 0) {
    await rememberIncident({ code: STALE_PROCESSEDAT_CODE, severity: 'warning', component: 'rectifier', message: STALE_PROCESSEDAT_MSG, context: { patched: backfilled } })
    await recordRemedy({ code: STALE_PROCESSEDAT_CODE, severity: 'warning', component: 'rectifier', message: STALE_PROCESSEDAT_MSG }, { remedy: 'backfill_processed_at', outcome: 'success', context: { patched: backfilled } })
    details.push(`backfilled ${backfilled} completed items missing processedAt`)
  }

  const linked = await linkOrphanLogs()
  if (linked > 0) {
    await rememberIncident({ code: ORPHAN_LOG_CODE, severity: 'warning', component: 'rectifier', message: ORPHAN_LOG_MSG, context: { patched: linked } })
    await recordRemedy({ code: ORPHAN_LOG_CODE, severity: 'warning', component: 'rectifier', message: ORPHAN_LOG_MSG }, { remedy: 'link_orphan_logs', outcome: 'success', context: { patched: linked } })
    details.push(`scanned unlinked transaction logs and linked ${linked}`)
  }

  return { patched: backfilled + linked, details }
}

/**
 * Record escalated findings into the swarm's collective memory so the swarm
 * UNDERSTANDS recurring problems even when it is forbidden from auto-fixing.
 */
async function rememberFindings(findings: Finding[]): Promise<number> {
  let recorded = 0
  for (const f of findings) {
    const severity: SwarmSeverity = f.severity === 'info' ? 'info' : f.severity === 'warning' ? 'warning' : 'critical'
    await rememberIncident({
      code: f.code,
      severity,
      component: 'rectifier',
      message: f.title,
      context: { detail: f.detail, entityId: f.entityId },
    })
    recorded++
  }
  return recorded
}

/**
 * Escalate unsafe drift — findings that must NOT be auto-fixed.
 */
export async function escalateUnsafeDrift(): Promise<Finding[]> {
  const findings: Finding[] = []
  const [missingRef, unverified] = await Promise.all([
    findCompletedWithoutExternalRef(),
    findUnverifiedRevenue(),
  ])
  for (const s of missingRef) {
    findings.push({
      severity: 'critical',
      code: 'STRICT-001',
      title: 'Completed settlement without external reference',
      detail: `Settlement ${s.id} (${s.amount} ${s.currency}) has no externalRef — needs real rail confirmation`,
      autoRemediable: false,
      entityId: s.id,
    })
  }
  for (const r of unverified) {
    findings.push({
      severity: 'warning',
      code: 'REVENUE-UNVERIFIED',
      title: 'Revenue without verifiable proof',
      detail: `Revenue event ${r.id} (${r.amount} ${r.currency}) lacks cryptographically verifiable proof`,
      autoRemediable: false,
      entityId: r.id,
    })
  }
  return findings
}

export async function runRectifier(): Promise<AgentRun> {
  const start = Date.now()
  const steps: AgentStepResult[] = []

  const drift = await time(detectDrift)
  steps.push({
    step: 'detect_drift',
    status: drift.result.driftDetected ? 'warn' : 'ok',
    itemsAffected: 0,
    details: drift.result.driftDetected
      ? `Drift detected: ${drift.result.diff}`
      : drift.result.hasPrevious
        ? 'No drift since last snapshot'
        : 'Baseline not established',
    durationMs: drift.durationMs,
  })

  const remedy = await time(remedySafeDrift)
  steps.push({
    step: 'remedy_safe_drift',
    status: 'ok',
    itemsAffected: remedy.result.patched,
    details: `${remedy.result.patched} safe fix(es): ${remedy.result.details.join('; ') || 'none'}`,
    durationMs: remedy.durationMs,
  })

  const escalated = await time(escalateUnsafeDrift)
  steps.push({
    step: 'escalate_unsafe_drift',
    status: escalated.result.length > 0 ? 'warn' : 'ok',
    itemsAffected: escalated.result.length,
    details: `${escalated.result.length} escalated (require real external rails / human action)`,
    durationMs: escalated.durationMs,
  })

  // Swarm collective memory: understand the errors just found, then
  // self-correct any pattern for which a remedy has been proven.
  const memory = await time(async () => {
    const recorded = await rememberFindings(escalated.result)
    const applied: string[] = []
    for (const input of [
      { code: STALE_PROCESSEDAT_CODE, message: STALE_PROCESSEDAT_MSG },
      { code: ORPHAN_LOG_CODE, message: ORPHAN_LOG_MSG },
    ]) {
      const res = await applyLearnedRemedy(
        { code: input.code, severity: 'warning', component: 'rectifier', message: input.message },
        async (remedy) => {
          const patched = remedy === 'link_orphan_logs' ? await linkOrphanLogs() : await backfillProcessedAt()
          return patched > 0 ? 'success' : 'noop'
        },
      )
      if (res.applied) applied.push(res.reason)
    }
    return { recorded, applied }
  })
  steps.push({
    step: 'swarm_memory_learning',
    status: memory.result.applied.length > 0 ? 'warn' : 'ok',
    itemsAffected: memory.result.recorded,
    details: `recorded ${memory.result.recorded} finding(s); ${memory.result.applied.length > 0 ? `self-corrected: ${memory.result.applied.join('; ')}` : 'no learned remedy needed'}`,
    durationMs: memory.durationMs,
  })

  const snapshot = await time(async () => {
    const summary = await computeStateSummary()
    return snapshotState('on_demand')
  })
  steps.push({
    step: 'write_state_snapshot',
    status: 'ok',
    itemsAffected: 1,
    details: `Snapshot recorded (${snapshot.result.integrityHash?.slice(0, 12)}…)`,
    durationMs: snapshot.durationMs,
  })

  return {
    phase: 'rectify',
    status: 'success',
    steps,
    startedAt: new Date(start).toISOString(),
    durationMs: Date.now() - start,
  }
}
