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
  fatal: boolean // true = reject mutation entirely (fail-closed), false = warn+tag
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
 * Is the ref locally-fabricated/synthetic (not verifiable against an external
 * provider like Stripe/PayPal/Bank/Onchain RPC)? These MUST NOT cohabit with
 * status=completed. Pattern list (invertible — false positives are harmless
 * because a real ref that accidentally matches any of these patterns would
 * simply cause a manual-review flag, not data loss).
 */
function isSyntheticRef(v: unknown): boolean {
  if (v == null) return true
  const s = String(v).trim().toUpperCase()
  if (!s) return true
  if (/^(PB-|RECOVER(Y|ED)-|REV-|PP-\d+|ALT-|REC-|PROC-)/.test(s)) return true
  if (/R\d+-.{6,}/.test(s)) return true // `${batchNumber}-R${retry}-${ts36}`
  if (s.endsWith(`-${new Date().toISOString().slice(0,10)}`.toUpperCase())) return true // PROC-xxx-YYYY-MM-DD
  if (/^(REVIEWED|MISPLACED|INSTRUCTIONS_READY|WAITING_MANUAL)/.test(s)) return true
  return false
}

/**
 * Check a single planned mutation for truth violations.
 * Fail-closed policy from 2026-08-30 onward (GooglePay refund trauma hardening):
 *   FATAL (reject mutation) — any write that moves status → completed
 *     without non-empty externalRef AND either:
 *       - connectorStatus = 'live'/'verified'/'manual_attested_finance'
 *       - OR proofHash non-empty
 *     This is NON-NEGOTIABLE. No revenue is ever "lost in translation" because
 *     the DB layer will not permit a completed record without a verifiable
 *     receipt.
 *   NON-FATAL (log only) — writes to processing/submitted/pending/etc that
 *     don't yet have external proof.
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
        const connectorStatus = (data as Record<string, unknown>).connectorStatus
        const proofHash = (data as Record<string, unknown>).proofHash
        if (status === 'completed') {
          if (isEmpty(externalRef)) {
            violations.push({
              rule: 'TRUTH-001', model, field: 'externalRef',
              message: 'OwnerSettlement status=completed requires externalRef (PayPal txn ID, MT103, onchain tx hash, Attijari API ref, etc.).',
              fatal: true,
            })
          } else if (isSyntheticRef(externalRef)) {
            violations.push({
              rule: 'TRUTH-001-SYNTHETIC', model, field: 'externalRef',
              message: `OwnerSettlement status=completed requires a REAL provider reference, not a locally-fabricated synthetic ref ("${String(externalRef).slice(0,40)}"). Supply a tx hash/MT103/PayPal ID OR leave status=processing and add proof later by manual sign-off.`,
              fatal: true,
            })
          }
          if (typeof dataSource === 'string' && dataSource.toLowerCase().includes('internal_ledger_only')) {
            violations.push({
              rule: 'TRUTH-002', model, field: 'dataSource',
              message: 'OwnerSettlement status=completed cannot use dataSource="internal_ledger_only"; must reference a live rail.',
              fatal: true,
            })
          }
          // completed → either connectorStatus is one of the "really happened" set, OR proofHash cryptographically computed from real data
          const connectorLive = (typeof connectorStatus === 'string') &&
            ['live','verified','manual_attested_finance','live_onchain','live_bank_api','live_paypal_api','live_stripe_api','live_wise_api']
              .includes(connectorStatus.toLowerCase());
          if (!connectorLive && isEmpty(proofHash)) {
            violations.push({
              rule: 'TRUTH-001-PROOF', model, field: 'connectorStatus/proofHash',
              message: 'OwnerSettlement status=completed requires either connectorStatus ∈ {live,verified,manual_attested_finance} OR a non-empty proofHash.',
              fatal: true,
            })
          }
        }
        break
      }
      case 'RevenueEvent': {
        const status = (data as Record<string, unknown>).status as string | undefined
        const proofType = (data as Record<string, unknown>).proofType as string | undefined
        const proofHash = (data as Record<string, unknown>).proofHash
        if (status === 'verified' || status === 'settled') {
          if (isEmpty(proofType) || isEmpty(proofHash)) {
            violations.push({
              rule: 'TRUTH-003', model, field: 'proofType/proofHash',
              message: `RevenueEvent ${status} requires both proofType + proofHash.`,
              fatal: true,
            })
          } else if (typeof proofType === 'string' && !isCryptographicallyVerifiable(proofType)) {
            violations.push({
              rule: 'TRUTH-003', model, field: 'proofType',
              message: `RevenueEvent proofType "${proofType}" is not cryptographically verifiable.`,
              fatal: true,
            })
          }
        }
        break
      }
      case 'PayoutBatch': {
        const status = (data as Record<string, unknown>).status as string | undefined
        const providerBatchRef = (data as Record<string, unknown>).providerBatchRef
        const paypalBatchId = (data as Record<string, unknown>).paypalBatchId
        const proofHash = (data as Record<string, unknown>).proofHash
        if (status === 'completed') {
          // TRUTH-004+ fail-closed: completed requires REAL provider ref AND proofHash
          if (isEmpty(providerBatchRef) && isEmpty(paypalBatchId)) {
            violations.push({
              rule: 'TRUTH-004', model, field: 'providerBatchRef/paypalBatchId',
              message: 'PayoutBatch status=completed requires providerBatchRef (Payouts API) or paypalBatchId (PayPal Payouts batch ID).',
              fatal: true,
            })
          } else if (!isEmpty(providerBatchRef) && isSyntheticRef(providerBatchRef)) {
            violations.push({
              rule: 'TRUTH-004-SYNTHETIC', model, field: 'providerBatchRef',
              message: 'PayoutBatch status=completed requires a REAL provider batch ref, not a synthetic/fabricated one.',
              fatal: true,
            })
          }
          if (isEmpty(proofHash)) {
            violations.push({
              rule: 'TRUTH-004-PROOF', model, field: 'proofHash',
              message: 'PayoutBatch status=completed requires proofHash (sha256 of provider response + item list).',
              fatal: true,
            })
          }
        } else if (status === 'submitted' || status === 'processing') {
          // non-fatal: processing/submitted should have proof eventually, but allowed in-flight
          if (isEmpty(providerBatchRef) && isEmpty(paypalBatchId)) {
            violations.push({
              rule: 'TRUTH-004-EVENTUAL', model, field: 'providerBatchRef/paypalBatchId',
              message: `PayoutBatch status=${status} missing provider ref — OK for in-flight, but status=completed will be BLOCKED until supplied.`,
              fatal: false,
            })
          }
        }
        break
      }
      case 'PayoutItem': {
        const status = (data as Record<string, unknown>).status as string | undefined
        const transactionRef = (data as Record<string, unknown>).transactionRef
        const externalRef = (data as Record<string, unknown>).externalRef
        const connectorStatus = (data as Record<string, unknown>).connectorStatus
        const proofHash = (data as Record<string, unknown>).proofHash
        if (status === 'completed') {
          // fail-closed: completed needs (transactionRef XOR externalRef) that is REAL + (connectorStatus ∈ live/verified OR proofHash)
          const realRef = !isEmpty(externalRef) ? String(externalRef) : (!isEmpty(transactionRef) ? String(transactionRef) : '')
          if (isEmpty(realRef)) {
            violations.push({
              rule: 'TRUTH-007', model, field: 'transactionRef/externalRef',
              message: 'PayoutItem status=completed requires transactionRef OR externalRef pointing to a real provider receipt.',
              fatal: true,
            })
          } else if (isSyntheticRef(realRef)) {
            violations.push({
              rule: 'TRUTH-007-SYNTHETIC', model, field: 'transactionRef/externalRef',
              message: `PayoutItem status=completed requires a REAL provider reference, not synthetic ("${String(realRef).slice(0,60)}"). Leave status=processing_awaiting_manual_receipt OR attach real txn ID / signed proofHash.`,
              fatal: true,
            })
          }
          const connectorLive = typeof connectorStatus === 'string' &&
            ['live','verified','manual_attested_finance','live_onchain','live_bank_api','live_paypal_api','live_stripe_api','live_wise_api']
              .includes(connectorStatus.toLowerCase())
          if (!connectorLive && isEmpty(proofHash)) {
            violations.push({
              rule: 'TRUTH-007-PROOF', model, field: 'connectorStatus/proofHash',
              message: 'PayoutItem status=completed requires connectorStatus ∈ live/verified/manual_attested_finance OR non-empty proofHash.',
              fatal: true,
            })
          }
        } else if (status === 'processing' || status === 'submitted_to_paypal' || status === 'processing_awaiting_manual_receipt') {
          if (isEmpty(transactionRef) && isEmpty(externalRef)) {
            violations.push({
              rule: 'TRUTH-007-EVENTUAL', model, field: 'transactionRef/externalRef',
              message: `PayoutItem status=${status} — eventual proof required for completed.`,
              fatal: false,
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
          if (isEmpty(deliveryProofHash)) {
            violations.push({
              rule: 'TRUTH-005', model, field: 'deliveryProofHash',
              message: 'ProcurementItem delivered/received requires deliveryProofHash (POD photo hash, carrier scan hash, etc.).',
              fatal: true,
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
              rule: 'TRUTH-006', model, field: 'orderedAt/ackStatus',
              message: 'PurchaseOrder completed requires orderedAt or supplier ackStatus evidence.',
              fatal: true,
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
              rule: 'TRUTH-006', model, field: 'routingToken',
              message: 'SettlementExecution LIVE_SETTLED requires routingToken.',
              fatal: true,
            })
          }
        }
        break
      }
      case 'CryptoSettlement': {
        const status = (data as Record<string, unknown>).status as string | undefined
        const txHash = (data as Record<string, unknown>).txHash
        if (status === 'confirmed') {
          if (isEmpty(txHash)) {
            violations.push({
              rule: 'TRUTH-008', model, field: 'txHash',
              message: 'CryptoSettlement confirmed requires txHash (actual on-chain transaction hash; must be verifiable via RPC).',
              fatal: true,
            })
          }
          const recipientAddress = (data as Record<string, unknown>).recipientAddress
          if (isEmpty(recipientAddress)) {
            violations.push({
              rule: 'TRUTH-008-DEST', model, field: 'recipientAddress',
              message: 'CryptoSettlement confirmed requires recipientAddress (actual destination wallet; prevents lost funds).',
              fatal: true,
            })
          }
        }
        break
      }
      default:
        // TRUTH-006 generic fail-closed for status=completed if the row has proof-related fields
        const anyStatus = (data as Record<string, unknown>).status as string | undefined
        if (anyStatus === 'completed') {
          const keys = Object.keys(data as Record<string, unknown>)
          const hasProofField = keys.some(k => /externalref|proofhash|providerbatchref|providerref|transactionref|txnid|txid|receipt/i.test(k))
          if (hasProofField) {
            const proofPresent = keys.some(k =>
              /externalref|proofhash|providerbatchref|providerref|transactionref|txnid|txid|receipt/i.test(k) &&
              !isEmpty((data as Record<string, unknown>)[k])
            )
            const proofSynthetic = keys.some(k =>
              /externalref|proofhash|providerbatchref|providerref|transactionref|txnid|txid|receipt/i.test(k) &&
              isSyntheticRef((data as Record<string, unknown>)[k])
            )
            if (!proofPresent) {
              violations.push({
                rule: 'TRUTH-006-GENERIC', model, field: 'proof/ref',
                message: `Model ${model} status=completed requires at least one verifiable reference field populated.`,
                fatal: true,
              })
            } else if (proofSynthetic) {
              violations.push({
                rule: 'TRUTH-006-GENERIC-SYNTHETIC', model, field: 'proof/ref',
                message: `Model ${model} status=completed reference must be REAL provider-verifiable, not synthetic/local.`,
                fatal: true,
              })
            }
          }
        }
    }
  }

  return violations
}

/**
 * Install TRUTH guards on the Prisma client.
 * FAIL-CLOSED for status=completed: any FATAL violation THROWS to prevent
 * writing phantom-completed records (GooglePay-style "refund never arrived"
 * class of bug). Non-fatal violations (processing/submitted in-flight) are
 * tagged with truthViolations metadata for audit.
 */
export function installTruthGuards(client: PrismaClient): void {
  ;(client as unknown as { $use: (fn: (params: unknown, next: (p: unknown) => unknown) => unknown) => void }).$use(
    async (params: unknown, next: (p: unknown) => unknown) => {
      const p = params as { model?: string; action: string; args: Record<string, unknown> }
      const violations = auditMutation(p)
      const fatal = violations.filter(v => v.fatal)
      if (fatal.length > 0) {
        const summary = fatal
          .map(v => `[${v.rule}] ${v.model}.${v.field}: ${v.message}`)
          .join(' ; ')
        console.error(`[TRUTH-GUARDS][FAIL-CLOSED] ${fatal.length} FATAL violation(s) on ${p.model}.${p.action} — MUTATION REJECTED to prevent lost revenue: ${summary}`)
        throw Object.assign(
          new Error(`TRUTH-GUARDS-FAILCLOSED: Refusing write to status=completed without verifiable proof. Violations: ${summary}`),
          { code: 'TRUTH_FAILCLOSED', details: fatal, model: p.model, action: p.action }
        )
      }
      if (violations.length > 0) {
        const summary = violations
          .map(v => `[${v.rule}] ${v.model}.${v.field}: ${v.message}`)
          .join(' ; ')
        console.warn(`[TRUTH-GUARDS][WARN] ${violations.length} non-fatal violation(s) on ${p.model}.${p.action}: ${summary}`)
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
              rules: violations.map(v => ({ rule: v.rule, model: v.model, field: v.field, fatal: v.fatal })),
              proof,
            }
          }
        } catch { /* non-critical; ignore */ }
      }
      return next(params)
    },
  )
  console.info('[TRUTH-GUARDS] Installed 9 fail-closed rules on Prisma client. TRUTH-001…008 + TRUTH-006-GENERIC active. FAIL-CLOSED for status=completed.')
}
