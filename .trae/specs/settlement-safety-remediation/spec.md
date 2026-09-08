# Settlement Safety Remediation - Product Requirements Document

## Overview
- **Summary**: Eliminate five P0 financial integrity defects in the settlement/payout architecture and consolidate three overlapping payment engines into one durable, idempotent state machine. Stop phantom-completed writes (instruction ≠ submission ≠ settlement), remove auto-drain balance logic, add UNKNOWN payment state, enforce reservation against double payout, provider reconciliation before retry, and a watchdog for stuck payouts. Only the final external reconciliation step may write `settled=true`.
- **Purpose**: Bring the autonomous payout system from ~25-30% financial-execution safety to production-grade. Guarantee that a revenue event combined with worker crash + provider timeout + worker restart yields exactly one payment to the correct destination (Owner destination.
- **Target Users**: Owner (principal payout controller); autonomous daemon workers; ops dashboard APIs; Base44 ledger reconciliation agents.

## Goals
- G1. **Stop phantom-completed writes**: never mark any `settled=true` / `status=completed` unless a verifiable `externalRef` (PayPal txn, MT103, onchain hash, bank statement line) exists and has been provider-reconciled.
- G2. **Remove auto-drain payout loops**: eliminate unconditional `balance > threshold → payout entire balance` cron patterns; replace with reservation + explicit authorization.
- G3. **One settlement engine**: consolidate overlapping payout paths (autonomous-daemon payout runner, external-payment-api, settlement-engine.ts) into a single code path with a proper state machine.
- G4. **Durable state machine**: define and enforce the full lifecycle REVENUE → RECONCILED → OWNER_ENTITLEMENT → PAYOUT_PROPOSAL → POLICY → RESERVATION → INSTRUCTION → IDEMPOTENCY_KEY → PROVIDER_SUBMISSION → PROVIDER_REF → PROCESSING → CONFIRMED → PROVIDER_RECONCILED → SETTLED. Add explicit UNKNOWN state for in-flight after submission with no provider update.
- G5. **Exactly-once semantics**: atomic reservation (double-payout prevention), idempotency records, and reconciliation-worker guarantees that a duplicate submission for the same entitlement is deduplicated across all workers.
- G6. **Watchdog for stuck payouts**: detect PROCESSING/UNKNOWN payouts older than threshold, quarantine, trigger escalation instead of blind retry.

## Non-Goals
- NG1. No new payment rails (no Wise/Binance/Bybit/Stripe onboarding). Rail wrappers stay, only hardened.
- NG2. No UI/UX changes to existing ops dashboard (API responses may add fields only for new state values).
- NG3. No migration of historical settlement records (legacy rows remain; new writes use new engine).
- NG4. No removal of the Prisma schema OwnerAccount/PayoutBatch/PayoutItem models (already defined; we wire them correctly instead of local/SQLite state).
- NG5. No new external dependencies (reuse Prisma, existing crypto-utils, single-writer-lock).

## Background & Context
The repo currently contains at least three paths that perform owner payout:
 1. `src/autonomous-daemon.mjs` → runs `scripts/auto-settle-owner.mjs` via `runAutoSettleOwner()` on the daemon tick, plus `runTick()` which dispatches Base44 emit commands (`--report-approved-batches`, `--export-payout-truth`, `--report-stuck-payouts`, `--available-balance`) and performs auto-approval, auto-submission of PayPal batches.
 2. `src/api/external-payment-api.mjs` → `ExternalPaymentAPI` exposes `requestAutoSettlement`, `requestPayPalPayout`, `requestBankWireTransfer`, `requestCryptoTransfer`, `requestPayoneerTransfer` → each calls `AdvancedFinancialManager.gateway.initiate*` with a generated UUID idempotency key but no durable reservation against owner entitlement, no state machine, only `SWARM_LIVE`/sandbox/authority pre-flight + `preExecutionOwnerCheck`/`enforceOwnerDirective`.
 3. `src/lib/settlement-engine.ts` → `executeWetRun()`/`finalizeSettlement()` performs simulation → wet-run → live with locks, then calls `settleAndPayout()` at LIVE_SETTLED` via `settlement-engine` finalizeSettlement`.

Each path has overlapping responsibility, yet writes to different backends:
  - Path 1 uses Base44 service entity writes + local JSON offline store.
  - Path 2 calls `AdvancedFinancialManager.gateway` (internal to `ExternalGatewayManager).
  - Path 3 writes Prisma tables (SettlementExecution / OwnerSettlement / RevenueEvent / AuditLedger + triggers a `settleAndPayout()` against the Prisma models.

The P0 integrity failure modes identified:
  F1. Instruction generation = settled. Payoneer CSV / bank wire CSVs exported set `status: 'export_ready'` / `settled: true` on revenue/earning records (auto-settle-owner).
  F2. Balance-drain cron: if (balance > threshold) send entire balance without reservation (GitHub analysis' real_settlement_backend style pattern; patterns observed in autonomous-daemon auto-approve + auto-submit without cross-worker lockless decisions.
  F3. Direct payout endpoints no reservation: ExternalPaymentAPI takes items and calls gateway methods with ephemeral idempotency keys not persisted before submission; the SQLite backend can't participate in the Prisma/PayoutBatch reservation ledger.
  F4. Hard-coded OWNER destinations fallbacks: auto-settle-owner.mjs l.102-107 falls back to `process.env.OWNER_PAYONEER_EMAIL || process.env.PAYONEER_EMAIL` for recipientEmail; similar for PayPal/RIB/crypto across multiple files instead of OwnerAccount rows with verified fingerprints.
  F5. Multiple settlement engines. No single source of truth for payout lifecycle state. concurrent tick + direct API + settlement-engine each decide and write independently.
  F6. No UNKNOWN state: after provider submission (e.g. PayPal Payouts API returned `batch_status: PROCESSING`), if no webhook/GET in N hours there is no explicit indeterminate state; retry resubmits without provider reconciliation first.
  F7. Provider reconciliation before retry absent. Stuck payouts retried blindly instead of calling GET /payouts-item before resubmit.
  F8. Atomic reservation absent: `settleAndPayout()` allocate bucket splits, but no owner entitlement + payout proposal → does not hold a per-row row-level lock against other workers picking the same RevenueEvent/PayoutItem.

Constraints (from project_memory):
  C1. `autodisbursetopresetowner` must remain true by default; writes require `OWNER_EXEC_UNLOCK` >=16 chars.
  C2. Terminal statuses (completed/verified/settled) forbidden for synthetic refs (`PB-*`, `INSTRUCTIONS_READY`). Postgres triggers enforce already; app layer must not bypass.
  C3. Fail-closed: Stripe/Tron/GooglePay/PayPal must throw `RAIL_NOT_CONFIGURED` if creds/env missing/placeholders.
  C4. Stripe Connect skipped for MA owners; MENA routing Wise→PayPal→Payoneer→Crypto→Bank Wire (Attijari).
  C5. 6 SQL BEFORE triggers on Neon PROD strictly block terminal writes if externalRef null or synthetic.
  C6. `trackingVerified` stays false until real tracking.
  C7. "International Shipping" labels deprecated null.
  C8. 3-Layer Truth Guard: Prisma middleware (truth-guards.ts), 6 Postgres BEFORE triggers, and app-layer resolvers prevent writing `completed` without verifiable externalRef + proofHash.

## Functional Requirements
FR-1. **SettlementEngine as single write-path. Every owner payout (daemon auto-settle, external payment API request, wet-run finalization) MUST route through ONE durable function that writes Prisma PayoutBatch/PayoutItem/OwnerSettlement tables only.
FR-2. **CSV/export_ready status NEVER sets RevenueEvent.status/settled=true; it only emits INSTRUCTION_READY with connectorStatus=pending_export and writes to the new PayoutInstruction with state=INSTRUCTION_GENERATED, requires manual/later provider.
FR-3. **Eliminate unconditional balance-drain: any cron/tick code path auto-threshold payout; every payout must be created from an explicit OwnerEntitlement (revenue → reconciled) → proposal → policy/limit gate → reservation → reservation before any provider call.
FR-4. **Explicit UNKNOWN payout state defined for submitted (PROVIDER_SUBMITTED with no PROVIDER response for > N hours).
FR-5. **Atomic row-level RESERVATION on RevenueEvent + PayoutItem for each proposed payout via Prisma transaction + idempotency key.
FR-6. **Durable IDEMPOTENCY records unique per (ownerAccountId, entitlementSource, entitlementRef) persisted before provider submission; duplicate keys resolve to existing PayoutItem id.
FR-7. **Provider reconciliation worker: for every PayoutItem in PROCESSING/UNKNOWN older than threshold, query provider API (PayPal GET /payouts-items/:item_id, etc.) and update state CONFIRMED/REJECTED/STUCK; never retry without reconciliation.
FR-8. **Owner destination lookup MUST resolve OwnerAccount.id → secret-managed destination → verified fingerprint; no hardcoded literal fallbacks in source code.
FR-9. **settled=true terminal write gated: only after (a) externalRef is present and non-synthetic, (b) provider reconciliation worker or webhook confirms provider SUCCESS, (c) proofHash = sha256(settledAt|amount|currency|externalRef) stored on PayoutItem/OwnerSettlement.
FR-10. **Direct payout API endpoints (/api/payout/*) require settlement authorization layer: authenticate caller, policy check, reservation, idempotency, write Prisma rows; never call provider directly from HTTP handler.
FR-11. **Watchdog/stuck payout: detect PROCESSING/UNKNOWN older than threshold, quarantine, escalate PaymentEscalation severity L1/L2; never auto-retry duplicate until reconciliation returns definitive REJECTED from provider.
FR-12. **Truth-guard integration: every state transition writes PayoutEvent (append-only event log) with stateFrom/stateTo/performedBy.

## Non-Functional Requirements
NFR-1. **Fail-closed every missing configuration: any rail without ensureReady() check throws RAIL_NOT_CONFIGURED.
NFR-2. **Backwards-compatible Prisma schema: all existing PayoutBatch / PayoutItem / PayoutEvent / OwnerSettlement / OwnerAccount models already defined; new columns added as optional, not deleted).
NFR-3. **Test coverage: exactly-once semantics test (same entitlement, duplicate submit, crash mid-flight, restart) → exactly one provider call.
NFR-4. **Audit trail: every terminal transition writes AuditLedger + PayoutEvent append-only.
NFR-5. **SWARM_LIVE gate retained; SWARM_LIVE=false → provider call happens (calls hit simulation only.

## Constraints
- **Technical**: Node 24, Prisma 7, Neon Postgres, Redis (optional). No new DB engine; drop all SQLite overlays deprecated for Prisma Postgres only.
- **Business**: 10% Salary / 40% Debt repayment / 30% Sovereign reserves / runtime 10% buffer / 10% ops (per user memory). Owner destinations verified via OwnerAccount registry only.
- **Dependencies**: truth-guards.ts Prisma middleware already present; single-writer-lock already present; crypto-utils sha256 already present; payout-routing.ts resolveBestPayoutRoute already present; owner-config already present.

## Assumptions
A1. Prisma schema already has the correct tables (PayoutBatch/PayoutItem/PayoutEvent/OwnerSettlement/OwnerAccount/PaymentEscalation). They are defined in `prisma/schema.prisma` (verified lines 47-509). No schema work required; only correct writes/reads wiring.
A2. Postgres triggers on Neon PROD (6 BEFORE triggers block terminal writes without externalRef) enforced DB-level. App layer must not attempt to bypass. Writes honor externalRef first, then attempt transition.
A3. The user wants an immediate remediation P0 disable of dangerous paths (F1 F2 F3 F4 F5) before engine consolidation. We do both in order (disable first, harden second).

## Open Questions
- [ ] Q1: OwnerAccount seeding: should existing env vars seed initial verified OwnerAccounts on startup, or require explicit owner-config seeder? (Assume A3 → keep env → initial seed existing via src/app/api/owner-accounts/seed/route.ts)
- [ ] Q2: UNKNOWN state threshold hours default?  Default: 4h for PayPal/Crypto, 24h for Bank Wire/Payoneer.
- [ ] Q3: Escalation destination. Default: create PaymentEscalation row + log only (no auto email).
- [ ] Q4: Retry limit before quarantine count? Default 1 provider reconciliation, then escalate after threshold.

## Acceptance Criteria

### AC-1: CSV export never writes settled=true (Rule)
- **Type**: `rule`
- **Given**: A Payoneer/bank CSV/XLS export runs for owner payout
- **When**: The engine writes status for the associated RevenueEvent/PayoutItem/OwnerSettlement is updated after export
- **Then**: No DB row has status INSTRUCTION_READY or export_ready written with settled=true/completed/verified
- **Pass Condition**: Grep codebase+test: `export_ready.*settle` → 0 hits; `manual_csv.*settled: true` → 0 hits. Integration test: run CSV export → assert PayoutItem.status == INSTRUCTION_GENERATED, assert RevenueEvent.status stays reconciled, assert OwnerSettlement.status stays processing.
- **Evidence**: grep + integration run output

### AC-2: No auto-drain balance-to-owner loops
- **Type**: `rule`
- **Given**: Any provider balance exceeds any configured threshold
- **When**: Daemon tick / cron /  fires
- **Then**: No code path executes payout of entire balance solely because balance > threshold. Payout only occurs after RevenueEvent exists → reconciled → explicit reservation is held on specific entitlement rows.
- **Pass Condition**: grep `balance > .*payout\|balance >.*execute\|if.*balance.*threshold\|cron.*schedule.*balance → 0 relevant matches; autonomous daemon tick run with balance threshold sim → no provider method calls unless explicit RevenueEvent+reservation exists.
- **Evidence**: grep + simulation run.

### AC-3: Single SettlementEngine write path
- **Type**: `rule`
- **Given**: Three entry points (daemon auto, HTTP payout request, wet-run finalize)
- **When**: Each requests a payout
- **Then**: All three code paths call the same `submitForSettlement()` function that writes PayoutBatch+PayoutItem+PayoutEvent atomically in Prisma tx
- **Pass Condition**: search code → ExternalPaymentAPI no longer calls fm.gateway.initiate* directly; autonomous-daemon no longer dispatches emit commands for payout creation; settlement-engine finalizeSettlement dispatches submitForSettlement not settleAndPayout raw
- **Evidence**: grep initiateAutoSettlement / requestPayPalPayout implementations → all call submitForSettlement

### AC-4: Durable state machine (all 13 stages + UNKNOWN
- **Type**: `rule`
- **Given**: A payout proceeds through normal lifecycle
- **When**: Each transition occurs
- **Then**: State strictly moves REVENUE → RECONCILED → OWNER_ENTITLEMENT → PROPOSAL → POLICY → RESERVATION → INSTRUCTION → IDEMPOTENCY → PROVIDER_SUBMITTED → PROCESSING → (on timeout → UNKNOWN) → PROVIDER_RECONCILED → CONFIRMED → SETTLED. Invalid transition rejected by truth guard.
- **Pass Condition**: PayoutEvent rows written for each transition; invalid transition attempt by test → throws/rejected.
- **Evidence**: Unit test: simulate each valid transitions → assert PayoutEvent.sequence correctness. Negative test: SETTLED→PROPOSAL → throws.

### AC-5: UNKNOWN state after PROCESSING timeout
- **Type**: `rule`
- **Given**: A PayoutItem is in state PROVIDER_SUBMITTED / PROCESSING
- **When**: No provider update arrives for > threshold hours
- **Then**: State transitions to UNKNOWN; watchdog marks PaymentEscalation; retry forbidden until provider reconciliation runs.
- **Pass Condition**: Advance time > threshold → watchdog runs → assert state=UNKNOWN and PaymentEscalation exists.
- **Evidence**: Unit test with time mock.

### AC-6: Atomic reservation (double-payout prevention)
- **Type**: `rule`
- **Given**: Two concurrent workers attempt to submit same RevenueEvent same owner entitlement
- **When**: Both race to create PayoutItem via submitForSettlement
- **Then**: Exactly one succeeds; one fails RESERVATION conflict. Provider is called once.
- **Pass Condition**: Vitest concurrent submitForSettlement twice parallel → assert rows.count === 1; provider mock called 1 time.
- **Evidence**: Vitest concurrent run output.

### AC-7: Durable idempotency (deduplication
- **Type**: `rule`
- **Given**: Same (ownerAccountId, entitlementRef) pair
- **When**: submitForSettlement called twice same idempotency key
- **Then**: Second call returns existing PayoutItem. No duplicate batch. No second provider call.
- **Pass Condition**: Vitest two invocations same key → assert same PayoutItem.id returned; provider mock 1 call.
- **Evidence**: Vitest run

### AC-8: Provider reconciliation before retry
- **Type**: `rule`
- **Given**: PayoutItem PROCESSING/UNKNOWN > retry requested
- **When**: Reconciliation worker fires before deciding action
- **Then**: Provider GET status for payout-item id; state transitions CONFIRMED/REJECTED. Only REJECTED/EXPIRED may allow a new PayoutItem (same entitlement (different idempotency key) be created. PROCESSING stays PROCESSING. CONFIRMED marks CONFIRMED.
- **Pass Condition**: Mock PROCESSING → worker → state preserved. Provider REJECTED → state REJECTED (new idempotency key required for retry).
- **Evidence**: Vitest mock provider + reconciliation worker runs

### AC-9: OwnerAccount lookup (no hardcoded fallbacks
- **Type**: `rule`
- **Given**: submitForSettlement needs destination
- **When**: Resolve destination
- **Then**: resolveBestPayoutRoute() returns route; route. source==='db' when OwnerAccount row; no source code literal OWNER_* fallback destination email/rib/wallet/crypto id used. All payout destination selection always writes owner id (OwnerAccount.id→ secret-managed destination with fingerprint
- **Pass Condition**: grep `process.env.OWNER_PAYPAL_EMAIL.*recipient\b\|process.env.OWNER_BANK\|process.env.OWNER_CRYPTO.*recipient\b` in payout execution paths → 0 matches. All routes resolveBestPayoutRoute used with OwnerAccount rows.
- **Evidence**: grep + unit test destination selection resolves db rows

### AC-10: settled=true gated on externalRef+proofHash+providerReconciled
- **Type**: `rule`
- **Given**: A PayoutItem has been submitted
- **When**: Engine attempts transition to SETTLED/COMPLETED/settled=true
- **Then**: Requires (externalRef present AND non-synthetic AND providerReconciliation confirmed SUCCESS AND proofHash computed and stored) else throws.
- **Pass Condition**: Integration test: attempt write settled without externalRef → error. Attempt with externalRef PB-* → error (6 triggers). Attempt with live PayPal txn after providerReconciled CONFIRMED + proofHash → success.
- **Evidence**: Integration test run + truth-guards pass

### AC-11: Direct payout API authorization layer
- **Type**: `rule`
- **Given**: HTTP POST /api/payout/*  called
- **When**: Handler runs
- **Then**: Handler calls submitForSettlement() → policy → reservation → idempotency → provider. Handler never calls gateway.initiate* directly
- **Pass Condition**: grep routes payout route handlers, inspect handlers →  all call submitForSettlement
- **Evidence**: grep handler code inspection

### AC-12: Watchdog/stuck payout quarantine/escalation
- **Type**: `rule`
- **Given**: PayoutItem PROCESSING/UNKNOWN > T+threshold
- **When**: Watchdog runs
- **Then**: Creates PaymentEscalation severity L1, no auto retry. PROCESSING→UNKNOWN after elapsed hours L1; UNKNOWN hours → L2. Escalation record written
- **Pass Condition**: Vitest watchdog, PaymentEscalation row count matches expected.
- **Evidence**: Vitest watchdog run.

### AC-13: PayoutEvent append-only log correctness
- **Type**: `rubric`
- **Dimension**: Append-only event sequence fidelity
- **Scale**: 1-5
- **Anchors**: 1 = no PayoutEvent written; 3 = some PayoutEvent state transitions but incomplete fields (missing entityType/performer); 5 = every state transition (including failed attempt) writes PayoutEvent with entityType,entityId, stateFrom, stateTo, performedBy, eventSequence strictly ++, no update/delete path on PayoutEvent (Read-only model (only inserts).
- **Pass Threshold**: >= 4
- **Evidence**: Code inspection + PayoutEvent DB writes for each transition; Prisma @@index and schema (eventSequence autoincrement.

### AC-14: Fail-closed rail (RAIL_NOT_CONFIGURED
- **Type**: `rubric`
- **Dimension**: Gate strictness and coverage for every provider rail
- **Scale**: 1-5
- **Anchors**: 1 = no ensureReady; 3 = some rails ensureReady for some rails PayPal only; 5 = every provider wrapper PayPal, Crypto/Bitget/Bybit/Stripe, Wise, Bank Wire/Attijari, Payoneer, Tron/GooglePay) has ensureReady() that throws RAIL_NOT_CONFIGURED for placeholder/missing.
- **Pass Threshold**: >= 4
- **Evidence**: Code inspection ensureReady for each rail.

### AC-15: Truth Guard coverage for new engine
- **Type**: `rubric`
- **Dimension**:  truth integration depth (middleware + triggers + resolver coverage of new submitForSettlement path
- **Scale**: 1-5
- **Anchors**: 1 bypasses truth guards; 3= some ( middleware only) ; 5 = engine writes through Prisma (middleware catches) runs truth middleware; SQL BEFORE triggers on the actual tables; resolver layer (API handlers) performs their own re-check before returning settled write.
- **Pass Threshold**: >= 4
- **Evidence**: Code inspection truth-guards.ts invocation + trigger enforcement resolver handlers.

### AC-16: Exactly-once semantics integration
- **Type**: `rubric`
- **Dimension**: End-to-end crash/restart fidelity (same RevenueEvent, crash mid, provider call, restart → once
- **Scale**: 1-5
- **Anchors**: 1 = multiple possible double payout possible; 3 = idempotency key in-memory only crash loses it; 5 = durable idempotency (persisted), Prisma tx row locks, concurrent workers race with crashes → exactly one provider call exactly one settled PayoutItem.
- **Pass Threshold**: >= 4
- **Evidence**: Vitest concurrent crash/restart simulation runs 50 parallel exactly once count === 1.

