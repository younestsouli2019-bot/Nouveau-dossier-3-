// ——— Self-Tester ———
// Runs the full verification suite: provider connectivity, ledger
// reconciliation, audit-chain integrity, strict-rule violations, and
// procurement integrity. Produces severity-ranked findings. Read-only:
// it never mutates state.

import { db } from '@/lib/db'
import { runFullReconciliation, verifyAuditChainIntegrity } from '@/lib/strict-enforcement/audit-reconciliation'
import {
  findCompletedWithoutExternalRef,
  findFictionalSettlements,
} from '@/lib/strict-enforcement/strict-settlement'
import { findProcurementDiscrepancies, findDeliveredWithoutReceipt } from '@/lib/strict-enforcement/strict-procurement'
import { rememberIncident } from '@/lib/swarm/memory'
import type { SwarmSeverity } from '@/lib/swarm/memory'
import { discoverProviderConnectivity } from './self-connector'
import type { AgentRun, AgentStepResult, Finding } from './types'

async function time<T>(fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
  const start = Date.now()
  const result = await fn()
  return { result, durationMs: Date.now() - start }
}

export async function runTester(): Promise<AgentRun> {
  const start = Date.now()
  const steps: AgentStepResult[] = []
  const findings: Finding[] = []

  const reconcile = await time(runFullReconciliation)
  const report = reconcile.result
  for (const v of report.violations) {
    findings.push({
      severity: v.severity,
      code: `RECONCILE-${v.rule || v.type}`,
      title: `${v.type}: ${v.rule ?? ''}`,
      detail: v.description,
      autoRemediable: false,
      entityId: v.entityId,
    })
  }
  steps.push({
    step: 'reconcile_ledger',
    status: report.integrityStatus === 'clean' ? 'ok' : report.integrityStatus === 'discrepancies_found' ? 'warn' : 'error',
    itemsAffected: report.summary.revenueEvents + report.summary.settlements,
    details: `${report.integrityStatus} — ${report.violations.length} violation(s)`,
    durationMs: reconcile.durationMs,
  })

  const chain = await time(verifyAuditChainIntegrity)
  steps.push({
    step: 'verify_audit_chain',
    status: chain.result.chainIntact ? 'ok' : 'warn',
    itemsAffected: 0,
    details: chain.result.chainIntact
      ? 'AuditLedger chain integrity verified'
      : `Audit chain broken: ${chain.result.brokenReason}`,
    durationMs: chain.durationMs,
  })
  if (!chain.result.chainIntact) {
    findings.push({
      severity: 'critical',
      code: 'AUDIT_CHAIN_BROKEN',
      title: 'Audit chain integrity violation',
      detail: chain.result.brokenReason,
      autoRemediable: false,
    })
  }

  const [missingRef, fictional, disc, deliveredNoReceipt, connectivity] = await Promise.all([
    findCompletedWithoutExternalRef(),
    findFictionalSettlements(),
    findProcurementDiscrepancies(),
    findDeliveredWithoutReceipt(),
    discoverProviderConnectivity(),
  ])

  steps.push({
    step: 'strict_settlement_rules',
    status: missingRef.length === 0 && fictional.length === 0 ? 'ok' : 'error',
    itemsAffected: missingRef.length + fictional.length,
    details: `${missingRef.length} completed-without-externalRef, ${fictional.length} fictional settlements`,
    durationMs: 0,
  })
  if (missingRef.length > 0) {
    findings.push({
      severity: 'critical',
      code: 'STRICT-001',
      title: 'Settlements completed without external reference',
      detail: `${missingRef.length} settlement(s) violate RWC-STRICT-001`,
      autoRemediable: false,
    })
  }
  if (fictional.length > 0) {
    findings.push({
      severity: 'critical',
      code: 'STRICT-001-FICTIONAL',
      title: 'Fictional completed settlements',
      detail: `${fictional.length} settlement(s) marked completed with internal_ledger_only dataSource`,
      autoRemediable: false,
    })
  }

  steps.push({
    step: 'strict_procurement_rules',
    status: disc.length === 0 && deliveredNoReceipt.length === 0 ? 'ok' : 'warn',
    itemsAffected: disc.length + deliveredNoReceipt.length,
    details: `${disc.length} quantity discrepancies, ${deliveredNoReceipt.length} delivered-without-receipt`,
    durationMs: 0,
  })
  if (disc.length > 0) {
    findings.push({
      severity: 'warning',
      code: 'RWC-PROC-001',
      title: 'Procurement quantity discrepancies',
      detail: `${disc.length} item(s) where quantityReceived != quantity`,
      autoRemediable: false,
    })
  }

  const liveRails = connectivity.filter((c) => c.mode === 'live').length
  const sandboxRails = connectivity.filter((c) => c.mode === 'sandbox').length
  steps.push({
    step: 'provider_connectivity',
    status: liveRails > 0 ? 'ok' : sandboxRails > 0 ? 'warn' : 'error',
    itemsAffected: connectivity.length,
    details: `live=${liveRails}, sandbox=${sandboxRails}, unconfigured=${connectivity.length - liveRails - sandboxRails}`,
    durationMs: 0,
  })

  const pendingProcurement = await db.procurementItem.count({ where: { status: 'pending' } })
  steps.push({
    step: 'procurement_backlog',
    status: pendingProcurement > 0 ? 'warn' : 'ok',
    itemsAffected: pendingProcurement,
    details: `${pendingProcurement} pending procurement item(s) awaiting pipeline routing`,
    durationMs: 0,
  })

  // Swarm collective memory: every verified violation is remembered so the
  // swarm learns which failure modes recur (and, via rectify, which remedies
  // eventually clear them).
  const remembered = await rememberFindings(findings)
  steps.push({
    step: 'swarm_memory_learning',
    status: 'ok',
    itemsAffected: remembered,
    details: `${remembered} finding(s) recorded in swarm collective memory`,
    durationMs: 0,
  })

  return {
    phase: 'test',
    status: steps.some((s) => s.status === 'error') ? 'error' : 'success',
    steps,
    startedAt: new Date(start).toISOString(),
    durationMs: Date.now() - start,
  }
}

async function rememberFindings(findings: Finding[]): Promise<number> {
  let recorded = 0
  for (const f of findings) {
    const severity: SwarmSeverity = f.severity === 'info' ? 'info' : f.severity === 'warning' ? 'warning' : 'critical'
    await rememberIncident({
      code: f.code,
      severity,
      component: 'self-tester',
      message: f.title,
      context: { detail: f.detail, entityId: f.entityId },
    })
    recorded++
  }
  return recorded
}
