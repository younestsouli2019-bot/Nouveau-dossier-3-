// ——— Cryptographic Utilities for RWC Strict Enforcement ———
// SHA-256 hashing, proof generation, and integrity verification.
// All hashes use Node.js crypto (Web Crypto not available in all runtimes).
// —————————————————————————————————————————————————————————

import { createHash, randomUUID } from 'crypto'

/**
 * Compute SHA-256 hash of a string.
 */
export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

/**
 * Compute SHA-256 hash of a JSON object (deterministic serialization).
 */
export function hashObject(obj: Record<string, unknown>): string {
  const canonical = JSON.stringify(obj, Object.keys(obj).sort())
  return sha256(canonical)
}

/**
 * Compute integrity hash for a batch of revenue events.
 * Hashes: all IDs + amounts + currencies in sorted order.
 */
export function computeBatchIntegrityHash(events: Array<{
  id: string; amount: number; currency: string; referenceId?: string | null
}>): string {
  const parts = events
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(e => `${e.id}:${e.amount}:${e.currency}:${e.referenceId ?? ''}`)
  return sha256(parts.join('|'))
}

/**
 * Compute settlement integrity hash for a batch.
 */
export function computeSettlementIntegrityHash(settlements: Array<{
  id: string; amount: number; currency: string; externalRef?: string | null
}>): string {
  const parts = settlements
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(s => `${s.id}:${s.amount}:${s.currency}:${s.externalRef ?? ''}`)
  return sha256(parts.join('|'))
}

/**
 * Verify a proof hash matches the expected content.
 */
export function verifyProof(content: string, claimedHash: string): boolean {
  const computed = sha256(content)
  return computed === claimedHash
}

/**
 * Generate a proof attestation object with hash.
 */
export function generateAttestation(data: Record<string, unknown>, attestor: string = 'system') {
  const hash = hashObject(data)
  return {
    proofHash: hash,
    proofType: 'manual_attestation' as const,
    proofVerifiedBy: attestor,
    proofVerifiedAt: new Date().toISOString(),
    data,
  }
}

/**
 * Generate a unique nonce for idempotency.
 */
export function generateNonce(): string {
  return randomUUID()
}

/**
 * Valid proof types that count as "cryptographically verifiable".
 */
export const VALID_PROOF_TYPES = [
  'onchain_tx_hash',
  'bank_mt103',
  'paypal_txn_id',
  'attijari_api',
  'api_receipt',
  'iso20022_xml',
] as const

export type ProofType = typeof VALID_PROOF_TYPES[number]

/**
 * Check if a proof type is considered cryptographically verifiable.
 * Manual attestations are NOT sufficient for strict mode.
 */
export function isCryptographicallyVerifiable(proofType: string | null | undefined): boolean {
  if (!proofType) return false
  return (VALID_PROOF_TYPES as readonly string[]).includes(proofType)
}
