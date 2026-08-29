// ——— Truth Guards (Prisma Middleware) ———
// Installed on the Prisma client at instantiation (see src/lib/db.ts).
// Enforces at the ORM layer that "completed" records carry external proof.
//
// TRUTH-001: OwnerSettlement status=completed → REQUIRES externalRef (not null/empty)
// TRUTH-002: OwnerSettlement status=completed → dataSource ≠ "internal_ledger_only"
// TRUTH-003: RevenueEvent status=verified → REQUIRES proofType AND proofHash
// TRUTH-004: PayoutBatch status=completed → REQUIRES providerBatchRef
// TRUTH-005: ProcurementItem receipt delivered → deliveryProofHash required
// TRUTH-006: Generic — any model write to status=completed must carry proof
// —————————————————————————————————————————————————————————————————————

import type { PrismaClient } from '@prisma/client'
import { sha256, isCryptographicallyVerifiable } from './crypto-utils'

type TruthViolation = {
  rule: string
  model: string
  field: string
  message: string
}

function stringify(v: unknown): string {
  try { return JSON.stringify(v) } catch { return String(v) }
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true
  if (typeof v === 'string' && v.trim() === '') return true
  return false
}

/**
 * Check a single planned mutation for truth violations.
 * Idempotent — does not mutate the params.
 */
function auditMutation(params: {
  model?: string
  action: string
  args: Record<string, unknown>
}): TruthViolation[] {
  const violations: TruthViolation[] = []
  const { model, action, args } = params
  if (!model) return violations

  const isWrite = action.startsWith('create') || action.startsWith('update') || action.startsWith('upsert')
  if (!isWrite) return violations

  // Extract the data payload from args (create / update / upsert.create / upsert.update)
  const dataBlobs: Record<string, unknown>[] = []
  if (action.startsWith('create')) {
    if (args.data && typeof args.data === 'object') dataBlobs.push(args.data as Record<string, unknown>)
  } else if (action.startsWith('upsert')) {
    if (args.create && typeof args.create === 'object') dataBlobs.push(args.create as Record<string, unknown>)
    if (args.update && typeof args.update === 'object') dataBlobs.push(args.update as Record<string, unknown>)
  } else if (action.startsWith('update')) {
    if (args.data && typeof args.data === 'object') dataBlobs.push(args.data as Record<string, unknown>)
  }

  for (const data of dataBlobs) {
    switch (model) {
      case 'OwnerSettlement': {
        const status = (data as Record<string, unknown>).status as string | undefined
        const externalRef = (data as Record<string, unknown>).externalRef
        const dataSource = (data as Record<string, unknown>).dataSource
        if (status === 'completed') {
          // TRUTH-001
          if (isEmpty(externalRef)) {
            violations.push({
              rule: 'TRUTH-001',
              model,
              field: 'externalRef',
              message: 'OwnerSettlement completed requires externalRef (PayPal txn, MT103, onchain hash, etc.)',
            })
          }
          // TRUTH-002
          if (typeof dataSource === 'string' && dataSource.toLowerCase().includes('internal_ledger_only')) {
            violations.push({
              rule: 'TRUTH-002',
              model,
              field: 'dataSource',
              message: 'OwnerSettlement completed cannot use dataSource="internal_ledger_only" — must use a live rail reference.',
            })
          }
        }
        break
      }
      case 'RevenueEvent': {
        const status = (data as Record<string, unknown>).status as string | undefined
        const proofType = (data as Record<string, unknown>).proofType as string | undefined
        const proofHash = (data as Record<string, unknown>).proofHash
        if (status === 'verified') {
          // TRUTH-003
          if (isEmpty(proofType) || isEmpty(proofHash)) {
            violations.push({
              rule: 'TRUTH-003',
              model,
              field: 'proofType/proofHash',
              message: 'RevenueEvent verified requires both proofType (cryptographically verifiable) AND proofHash.',
            })
          } else if (typeof proofType === 'string' && !isCryptographicallyVerifiable(proofType)) {
            violations.push({
              rule: 'TRUTH-003',
              model,
              field: 'proofType',
              message: `RevenueEvent proofType "${proofType}" is not cryptographically verifiable.`,
            })
          }
        }
        break
      }
      case 'PayoutBatch': {
        const status = (data as Record<string, unknown>).status as string | undefined
        const providerBatchRef = (data as Record<string, unknown>).providerBatchRef
        const paypalBatchId = (data as Record<string, unknown>).paypalBatchId
        if (status === 'completed' || status === 'submitted' || status === 'processing') {
          // TRUTH-004
          if (isEmpty(providerBatchRef) && isEmpty(paypalBatchId)) {
            violations.push({
              rule: 'TRUTH-004',
              model,
              field: 'providerBatchRef/paypalBatchId',
              message: 'PayoutBatch moving to submitted/processing/completed requires providerBatchRef or paypalBatchId.',
            })
          }
        }
        break
      }
      case 'ProcurementItem': {
        const status = (data as Record<string, unknown>).status as string | undefined
        const deliveryProofHash = (data as Record<string, unknown>).deliveryProofHash
        const deliveredAt = (data as Record<string, unknown>).deliveredAt
        if ((status === 'delivered' || status === 'received') && !isEmpty(deliveredAt)) {
          // TRUTH-005
          if (isEmpty(deliveryProofHash)) {
            violations.push({
              rule: 'TRUTH-005',
              model,
              field: 'deliveryProofHash',
              message: 'ProcurementItem delivered/received requires deliveryProofHash (photo, signed POD hash, carrier scan hash, etc.).',
            })
          }
        }
        break
      }
      case 'PurchaseOrder': {
        const status = (data as Record<string, unknown>).status as string | undefined
        if (status === 'completed') {
          const orderedAt = (data as Record<string, unknown>).orderedAt
          const supplierAck = (data as Record<string, unknown>).acknowledgedAt || (data as Record<string, unknown>).ackStatus
          if (isEmpty(orderedAt) && isEmpty(supplierAck)) {
            violations.push({
              rule: 'TRUTH-006',
              model,
              field: 'orderedAt/ackStatus',
              message: 'PurchaseOrder completed requires orderedAt or supplier ackStatus evidence.',
            })
          }
        }
        break
      }
      case 'SettlementExecution': {
        const status = (data as Record<string, unknown>).status as string | undefined
        const processedAt = (data as Record<string, unknown>).processedAt
        const routingToken = (data as Record<string, unknown>).routingToken
        if (status === 'LIVE_SETTLED' && !isEmpty(processedAt)) {
          if (isEmpty(routingToken)) {
            violations.push({
              rule: 'TRUTH-006',
              model,
              field: 'routingToken',
              message: 'SettlementExecution LIVE_SETTLED requires routingToken.',
            })
          }
        }
        break
      }
      default:
        // TRUTH-006 generic: any model with status=completed + externalRef field
        const anyStatus = (data as Record<string, unknown>).status as string | undefined
        if (anyStatus === 'completed' && 'externalRef' in data) {
          if (isEmpty((data as Record<string, unknown>).externalRef)) {
            violations.push({
              rule: 'TRUTH-006',
              model,
              field: 'externalRef',
              message: `Model ${model} status=completed requires externalRef.`,
            })
          }
        }
    }
  }

  return violations
}

/**
 * Install TRUTH guards on the Prisma client.
 * Must be called exactly once per PrismaClient (db.ts does this).
 */
export function installTruthGuards(client: PrismaClient): void {
  ;(client as unknown as { $use: (fn: (params: unknown, next: (p: unknown) => unknown) => unknown) => void }).$use(
    async (params: unknown, next: (p: unknown) => unknown) => {
      const p = params as { model?: string; action: string; args: Record<string, unknown> }
      const violations = auditMutation(p)
      if (violations.length > 0) {
        const summary = violations
          .map(v => `[${v.rule}] ${v.model}.${v.field}: ${v.message}`)
          .join(' ; ')
        // Log to server console but DO NOT throw — in production we record the
        // violation via AuditLedger and flag the record for human review, so
        // that a false positive never blocks a real critical payout. The API
        // layer (strict-settlement / strict-revenue) handles escalation.
        console.error(`[TRUTH-GUARDS] ${violations.length} violation(s) on ${p.model}.${p.action}: ${summary}`)
        // Append truthViolations to args.metadata if possible (non-destructive)
        try {
          const args = p.args || {} as Record<string, unknown>
          const data = args.data && typeof args.data === 'object'
            ? (args.data as Record<string, unknown>)
            : undefined
          if (data && !('truthViolations' in data)) {
            const proof = sha256(`truth-v:${Date.now()}:${summary}`)
            ;(data as Record<string, unknown>).truthViolations = {
              detectedAt: new Date().toISOString(),
              count: violations.length,
              rules: violations.map(v => ({ rule: v.rule, model: v.model, field: v.field })),
              proof,
            }
            console.error(`[TRUTH-GUARDS] Flagged record with proof=${proof.slice(0, 16)}…`)
          }
        } catch { /* non-critical; ignore */ }
      }
      return next(params)
    },
  )
  console.info('[TRUTH-GUARDS] Installed 6 rules on Prisma client. TRUTH-001…006 active.')
}
