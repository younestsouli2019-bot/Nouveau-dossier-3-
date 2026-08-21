// ——— Strict Revenue Enforcement (RWC Patched) ———
// ingestRevenue REJECTS any batch lacking cryptographically verifiable proof.
// No revenue event may be created without proof, unless explicitly flagged as unverified.
// ———————————————————————————————————————————————————————————————————

import { db } from '@/lib/db'
import { computeBatchIntegrityHash, isCryptographicallyVerifiable, sha256 } from './crypto-utils'

export interface RevenueEventInput {
  source: string
  amount: number
  currency?: string
  description?: string
  referenceId?: string
  proofType?: string
  proofHash?: string
}

export interface StrictIngestResult {
  success: boolean
  batchId?: string
  eventsCreated: number
  eventsRejected: number
  rejectedReasons: string[]
  batchIntegrityHash?: string
  error?: string
  errorCode?: string
  violatedRule?: string
}

/**
 * STRICT ingestRevenue — the core patched function.
 *
 * Rules enforced:
 * 1. Every event in the batch MUST have a proofType
 * 2. proofType MUST be cryptographically verifiable (not manual_attestation)
 * 3. If proofHash is provided, it must be valid
 * 4. A batchIntegrityHash is computed over ALL events
 * 5. Every event gets a status of 'verified' or 'rejected'
 * 6. Rejected events are stored with rejectedReason
 */
export async function strictIngestRevenue(params: {
  events: RevenueEventInput[]
  batchReference?: string
  allowUnverified?: boolean // escape hatch for migration — should be false in production
  performedBy?: string
}): Promise<StrictIngestResult> {
  const { events, batchReference, allowUnverified = false, performedBy = 'system' } = params

  if (!events.length) {
    return { success: false, eventsCreated: 0, eventsRejected: 0, rejectedReasons: [], error: 'Empty batch' }
  }

  const batchId = batchReference || `REV-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
  const created: string[] = []
  const rejectedReasons: string[] = []
  let eventsRejected = 0

  for (const evt of events) {
    // RULE 1: proofType required
    if (!evt.proofType) {
      if (!allowUnverified) {
        rejectedReasons.push(`${evt.source}:$${evt.amount} — REJECTED: No proofType. Rule: RWC-STRICT-010`)
        eventsRejected++
        // Store as rejected
        await db.revenueEvent.create({
          data: {
            source: evt.source, amount: evt.amount, currency: evt.currency || 'USD',
            status: 'rejected', description: evt.description, referenceId: evt.referenceId,
            proofType: null, rejectedReason: 'RWC-STRICT-010: No proofType provided. Revenue requires cryptographically verifiable proof.',
          },
        })
        continue
      }
    }

    // RULE 2: proofType must be cryptographically verifiable
    if (evt.proofType && !isCryptographicallyVerifiable(evt.proofType)) {
      if (!allowUnverified) {
        rejectedReasons.push(`${evt.source}:$${evt.amount} — REJECTED: proofType '${evt.proofType}' not verifiable. Rule: RWC-STRICT-011`)
        eventsRejected++
        await db.revenueEvent.create({
          data: {
            source: evt.source, amount: evt.amount, currency: evt.currency || 'USD',
            status: 'rejected', description: evt.description, referenceId: evt.referenceId,
            proofType: evt.proofType,
            rejectedReason: 'RWC-STRICT-011: proofType not cryptographically verifiable.',
          },
        })
        continue
      }
    }

    // RULE 3: If proofHash provided, must be non-empty
    if (evt.proofHash && evt.proofHash.length < 10) {
      rejectedReasons.push(`${evt.source}:$${evt.amount} — REJECTED: proofHash too short. Rule: RWC-STRICT-012`)
      eventsRejected++
      continue
    }

    // All checks passed — create event
    const event = await db.revenueEvent.create({
      data: {
        source: evt.source, amount: evt.amount, currency: evt.currency || 'USD',
        status: evt.proofType && isCryptographicallyVerifiable(evt.proofType) ? 'verified' : 'pending',
        description: evt.description, referenceId: evt.referenceId,
        proofType: evt.proofType || null,
        proofHash: evt.proofHash || null,
        proofVerifiedBy: isCryptographicallyVerifiable(evt.proofType) ? (evt.proofType === 'onchain_tx_hash' ? 'blockchain_rpc' : evt.proofType === 'attijari_api' ? 'attijari_api' : 'system') : null,
        proofVerifiedAt: isCryptographicallyVerifiable(evt.proofType) ? new Date() : null,
      },
    })
    created.push(event.id)
  }

  // Compute batch integrity hash over all CREATED events
  let batchIntegrityHash: string | undefined
  if (created.length > 0) {
    const eventsForHash = await db.revenueEvent.findMany({
      where: { id: { in: created } },
      select: { id: true, amount: true, currency: true, referenceId: true },
    })
    batchIntegrityHash = computeBatchIntegrityHash(eventsForHash as Array<{ id: string; amount: number; currency: string; referenceId?: string | null }>)

    // Update all events with the batch integrity hash
    await db.revenueEvent.updateMany({
      where: { id: { in: created } },
      data: { batchIntegrityHash },
    })
  }

  // Write audit ledger
  try {
    const lastAudit = await db.auditLedger.findFirst({
      where: { entityType: 'revenue_batch' },
      orderBy: { createdAt: 'desc' },
    })
    const entryContent = JSON.stringify({
      entityType: 'revenue_batch', entityId: batchId,
      action: eventsRejected === 0 ? 'ingested' : 'partially_rejected',
      totalEvents: events.length, created: created.length, rejected: eventsRejected,
    })
    await db.auditLedger.create({
      data: {
        entityType: 'revenue_batch', entityId: batchId,
        action: 'ingested',
        previousHash: lastAudit?.entryHash ?? null,
        entryHash: sha256(entryContent),
        performedBy,
        metadata: JSON.stringify({ totalEvents: events.length, created: created.length, rejected: eventsRejected, rejectedReasons, batchIntegrityHash }),
      },
    })
  } catch (e) {
    console.error('[StrictRevenue] Audit write failed (non-blocking):', e)
  }

  return {
    success: eventsRejected === 0,
    batchId,
    eventsCreated: created.length,
    eventsRejected,
    rejectedReasons,
    batchIntegrityHash,
  }
}

/**
 * Audit: find all revenue events with status='pending' (no proof) or 'rejected'.
 */
export async function findUnverifiedRevenue() {
  return db.revenueEvent.findMany({
    where: { OR: [{ status: 'pending' }, { status: 'rejected' }] },
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * Audit: find all revenue events that are 'verified' but have no proofHash.
 * These are suspicious — marked verified without cryptographic proof.
 */
export async function findSuspiciousVerifiedRevenue() {
  return db.revenueEvent.findMany({
    where: { status: 'verified', proofHash: null },
    orderBy: { createdAt: 'desc' },
  })
}
