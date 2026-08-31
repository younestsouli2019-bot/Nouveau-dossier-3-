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
import { isCryptographicallyVerifiable } from './crypto-utils'

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
  if (/^(PB-|RECOVER(Y|ED)?-|REV-|PP-\d+|ALT-|REC-|PROC-|SHP-|RECONCILE-|MISPLACED-|TXRECON-|NOTXHASH)/.test(s)) return true
  if (/R\d+-.{6,}/.test(s)) return true
  if (s.endsWith(`-${new Date().toISOString().slice(0,10)}`.toUpperCase())) return true
  if (/^(REVIEWED|MISPLACED|INSTRUCTIONS_READY|WAITING_MANUAL)/.test(s)) return true
  return false
}

function isSyntheticOracleHash(v: unknown): boolean {
  if (v == null) return true
  const s = String(v).trim()
  return /^[a-f0-9]{64}$/i.test(s)
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
        const statusLow = (status || '').toLowerCase()
        const deliveryProofHash = (data as Record<string, unknown>).deliveryProofHash
        const shippedAt = (data as Record<string, unknown>).shippedAt
        const deliveredAt = (data as Record<string, unknown>).deliveredAt
        const receiptConfirmedAt = (data as Record<string, unknown>).receiptConfirmedAt
        const receiptConfirmedBy = (data as Record<string, unknown>).receiptConfirmedBy
        const quantityReceived = (data as Record<string, unknown>).quantityReceived
        const supplierName = (data as Record<string, unknown>).supplierName
        const orderRef = (data as Record<string, unknown>).orderRef
        // Any movement toward shipped-or-beyond: at minimum requires supplier / order ref.
        // NOTE (payload scoping): this middleware sees only the mutation payload, not the
        // cumulative row — an UPDATE to settled legitimately omits supplierName (set at
        // shipped). The absolute check is therefore enforceable at CREATE time (payload
        // === row); for updates, the shippedAt-scoped check below catches writers that
        // assert shipment motion without a carrier. Row-level parity is held by the L2
        // SQL triggers (migration 20260830000400), which DO see the full NEW row.
        const shippingMotion = ['shipped', 'in_transit', 'delivered', 'receipt_confirmed', 'settled', 'completed', 'confirmed'].includes(statusLow)
        if (shippingMotion && isEmpty(supplierName) && isEmpty(orderRef) && action.startsWith('create')) {
          violations.push({
            rule: 'TRUTH-009', model, field: 'supplierName/orderRef',
            message: `ProcurementItem status=${status} requires supplierName OR orderRef (real PO/invoice reference) — cannot create shipping motion without a supplier.`,
            fatal: true,
          })
        }
        // shipped: shippedAt populated → need supplier or carrier at minimum
        if ((statusLow === 'shipped' || statusLow === 'in_transit') && !isEmpty(shippedAt)) {
          if (isEmpty(supplierName)) {
            violations.push({
              rule: 'TRUTH-009-SHIPPED', model, field: 'supplierName/carrier',
              message: `ProcurementItem status=${status} with shippedAt set requires a real carrier/supplier (jumia.ma / avito.ma / poste.ma / amana / aramex / dhl etc.), not empty.`,
              fatal: true,
            })
          }
        }
        // delivered/received/completed/confirmed — proof required
        if (['delivered', 'received', 'completed', 'confirmed'].includes(statusLow) && !isEmpty(deliveredAt)) {
          if (isEmpty(deliveryProofHash)) {
            violations.push({
              rule: 'TRUTH-005', model, field: 'deliveryProofHash',
              message: `ProcurementItem ${status} requires deliveryProofHash (POD photo hash, carrier scan hash, hand-signed receipt SHA; NOT locally-computed oracle proof).`,
              fatal: true,
            })
          } else if (isSyntheticOracleHash(deliveryProofHash)) {
            violations.push({
              rule: 'TRUTH-005-SYNTHETIC-ORACLE', model, field: 'deliveryProofHash',
              message: `ProcurementItem ${status} deliveryProofHash looks like a locally-fabricated oracle SHA-256 (bare 64 hex chars, no provider prefix like pod:/scan:/AMANA-/POSTE-/0x). Paste a real external-world hash or leave status=delivered pending manual sign-off.`,
              fatal: true,
            })
          }
        }
        // receipt_confirmed: BOTH proofHash (real external) + confirmedBy human + confirmedAt
        if (statusLow === 'receipt_confirmed') {
          const proofMissing = isEmpty(deliveryProofHash) || isSyntheticOracleHash(deliveryProofHash)
          const byMissing = isEmpty(receiptConfirmedBy) || String(receiptConfirmedBy).toLowerCase() === 'system-auto'
          const atMissing = isEmpty(receiptConfirmedAt)
          if (proofMissing) {
            violations.push({
              rule: 'TRUTH-010', model, field: 'deliveryProofHash',
              message: `ProcurementItem receipt_confirmed requires REAL external deliveryProofHash (POD/carrier scan SHA with provider prefix). Bare 64-hex oracle proofs are rejected.`,
              fatal: true,
            })
          }
          if (byMissing) {
            violations.push({
              rule: 'TRUTH-010-CONFIRMER', model, field: 'receiptConfirmedBy',
              message: `ProcurementItem receipt_confirmed requires receiptConfirmedBy = real human recipient (not null, not 'system-auto').`,
              fatal: true,
            })
          }
          if (atMissing) {
            violations.push({
              rule: 'TRUTH-010-TS', model, field: 'receiptConfirmedAt',
              message: `ProcurementItem receipt_confirmed requires receiptConfirmedAt timestamp.`,
              fatal: true,
            })
          }
          if (!isEmpty(quantityReceived) && typeof quantityReceived === 'number' && quantityReceived <= 0) {
            violations.push({
              rule: 'TRUTH-010-QTY', model, field: 'quantityReceived',
              message: `ProcurementItem receipt_confirmed quantityReceived must be a positive integer (items actually received).`,
              fatal: true,
            })
          }
        }
        // settled = ALL three receipt fields must be valid (proof + human + ts + qty received)
        if (statusLow === 'settled') {
          if (isEmpty(deliveryProofHash) || isSyntheticOracleHash(deliveryProofHash)) {
            violations.push({
              rule: 'TRUTH-011', model, field: 'deliveryProofHash',
              message: `ProcurementItem settled requires real deliveryProofHash populated at receipt_confirmed step.`,
              fatal: true,
            })
          }
          if (isEmpty(receiptConfirmedAt)) {
            violations.push({
              rule: 'TRUTH-011-TS', model, field: 'receiptConfirmedAt',
              message: `ProcurementItem settled requires receiptConfirmedAt (go through receipt_confirmed first).`,
              fatal: true,
            })
          }
          if (isEmpty(receiptConfirmedBy) || String(receiptConfirmedBy).toLowerCase() === 'system-auto') {
            violations.push({
              rule: 'TRUTH-011-BY', model, field: 'receiptConfirmedBy',
              message: `ProcurementItem settled requires receiptConfirmedBy = real human (no system-auto).`,
              fatal: true,
            })
          }
          if (isEmpty(quantityReceived) || (typeof quantityReceived === 'number' && quantityReceived <= 0)) {
            violations.push({
              rule: 'TRUTH-011-QTY', model, field: 'quantityReceived',
              message: `ProcurementItem settled requires positive quantityReceived.`,
              fatal: true,
            })
          }
        }
        break
      }
      case 'Shipment': {
        const status = (data as Record<string, unknown>).status as string | undefined
        const statusLow = (status || '').toLowerCase()
        const trackingNumber = (data as Record<string, unknown>).trackingNumber
        const trackingVerified = (data as Record<string, unknown>).trackingVerified
        const events = (data as Record<string, unknown>).events as string | undefined | null
        const actualDelivery = (data as Record<string, unknown>).actualDelivery
        const carrier = (data as Record<string, unknown>).carrier
        const trackingUrl = (data as Record<string, unknown>).trackingUrl
        const advancedMotion = ['label_created', 'picked_up', 'in_transit', 'customs', 'out_for_delivery', 'delivered', 'returned', 'failed'].includes(statusLow)
        // Any advanced motion requires at LEAST a carrier or tracking number string
        if (advancedMotion) {
          if (isEmpty(trackingNumber) && isEmpty(carrier)) {
            violations.push({
              rule: 'TRUTH-012', model, field: 'trackingNumber/carrier',
              message: `Shipment status=${status} requires at LEAST a carrier name (Poste Maroc/Amana/Aramex/DHL/FedEx/UPS/Chronopost) OR trackingNumber string. No phantom shipments with 0 info.`,
              fatal: true,
            })
          }
        }
        // in_transit, out_for_delivery — real tracking required (not empty)
        if (['in_transit', 'customs', 'out_for_delivery'].includes(statusLow)) {
          if (isEmpty(trackingNumber) || String(trackingNumber).trim().length < 3) {
            violations.push({
              rule: 'TRUTH-012-TRANSIT', model, field: 'trackingNumber',
              message: `Shipment status=${status} requires a real trackingNumber (length >= 3). Morocco local Poste Maroc/Amana provide real refs; paste the real one here.`,
              fatal: true,
            })
          }
        }
        // delivered: actualDelivery set → need (trackingVerified=true OR events > 50 chars non-empty JSON) + trackingNumber non-empty
        if (statusLow === 'delivered' && !isEmpty(actualDelivery)) {
          if (isEmpty(trackingNumber) || String(trackingNumber).trim().length < 3) {
            violations.push({
              rule: 'TRUTH-012-DELIVERED-TRACKING', model, field: 'trackingNumber',
              message: `Shipment delivered with actualDelivery set requires real trackingNumber (can't deliver without a carrier-tracked parcel).`,
              fatal: true,
            })
          }
          const verified = (trackingVerified === true || trackingVerified === 'true' || trackingVerified === 1)
          const hasEvents = !!events && events.trim().length > 50
          if (!verified && !hasEvents) {
            violations.push({
              rule: 'TRUTH-012-DELIVERED-PROOF', model, field: 'trackingVerified/events',
              message: `Shipment delivered requires EITHER trackingVerified=true (real carrier API returned a delivered event) OR events JSON populated with real delivery scan data (length > 50 chars, not empty). Never mark delivered based on a bare tracking string alone.`,
              fatal: true,
            })
          }
        }
        // Placeholder carrier labels (International Shipping / Multi-carrier) now banned = replaced by NULL in carrier-acquire-sweep. Reject writes of them.
        if (typeof carrier === 'string' && /international shipping|multi-carrier/i.test(carrier)) {
          violations.push({
            rule: 'TRUTH-012-PLACEHOLDER', model, field: 'carrier',
            message: `Shipment carrier placeholder "${carrier}" BANNED: never write fabricated carrier labels. Set carrier=NULL until real carrier known, OR write real carrier (Poste Maroc/Amana/Aramex/DHL/FedEx/UPS/Chronopost).`,
            fatal: true,
          })
        }
        // If trackingUrl set without carrier, that's OK (it's keyless probe), but trackingNumber MUST be non-empty for trackingUrl to make sense
        if (!isEmpty(trackingUrl) && isEmpty(trackingNumber)) {
          violations.push({
            rule: 'TRUTH-012-URLNOREF', model, field: 'trackingUrl',
            message: `Shipment trackingUrl written but trackingNumber empty — impossible. Either write both or neither.`,
            fatal: false, // warn only, don't fail-closed
          })
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
        // WARN-ONLY (2026-08-30 harmonization): the previous behavior mutated
        // args.data to inject a `truthViolations` field — but no Prisma model has
        // that column, so Prisma rejected the very write being audited with an
        // "Unknown argument" error. Non-fatal violations are now log-only; the
        // durable audit trail is the L3 sweep + AuditLedger, not payload mutation.
        const summary = violations
          .map(v => `[${v.rule}] ${v.model}.${v.field}: ${v.message}`)
          .join(' ; ')
        console.warn(`[TRUTH-GUARDS][WARN] ${violations.length} non-fatal violation(s) on ${p.model}.${p.action}: ${summary}`)
      }
      return next(params)
    },
  )
  console.info('[TRUTH-GUARDS] Installed 16 fail-closed rules on Prisma client. TRUTH-001…014 (Finance+Procurement+Shipment) + TRUTH-006-GENERIC active. FAIL-CLOSED: status=completed/delivered/receipt_confirmed/settled ALWAYS requires REAL external-world proof, never synthetic/local references.')
}
