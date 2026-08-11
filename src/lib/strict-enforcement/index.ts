// ——— RWC Strict Enforcement ———
// Unified exports for all strict enforcement modules.
// These patches enforce:
//   RWC-STRICT-001: markAsSettled requires external_ref for 'completed'
//   RWC-STRICT-002: proofType must be cryptographically verifiable
//   RWC-STRICT-003: proofHash must match computed hash
//   RWC-STRICT-004: No fictional settlements (internal_ledger_only + completed)
//   RWC-STRICT-010: Revenue events require proofType
//   RWC-STRICT-011: proofType must be verifiable
//   RWC-STRICT-012: proofHash must be valid length
//   RWC-PROC-001: Procurement qty mismatch detection
//   RWC-PROC-002: Delivery ≠ Receipt enforcement
// ———————————————————————————————————————————————————

export { sha256, hashObject, computeBatchIntegrityHash, computeSettlementIntegrityHash, verifyProof, generateAttestation, generateNonce, isCryptographicallyVerifiable, VALID_PROOF_TYPES, type ProofType } from './crypto-utils'
export { strictMarkAsSettled, strictBulkSettle, findCompletedWithoutExternalRef, findFictionalSettlements, type StrictSettleResult, type SettlementStatus } from './strict-settlement'
export { strictIngestRevenue, findUnverifiedRevenue, findSuspiciousVerifiedRevenue, type StrictIngestResult, type RevenueEventInput } from './strict-revenue'
export { runFullReconciliation, getAuditChain, verifyAuditChainIntegrity, getLedgerSnapshots, type ReconciliationReport } from './audit-reconciliation'
export { confirmReceipt, findProcurementDiscrepancies, findDeliveredWithoutReceipt, type ConfirmReceiptParams, type ReceiptResult } from './strict-procurement'
