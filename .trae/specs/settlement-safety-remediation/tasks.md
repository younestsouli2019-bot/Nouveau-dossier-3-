# Settlement Safety Remediation - Implementation Plan

## Task 1: Immediate P0 disable — remove settled=true on CSV export & auto-drain
- **Status**: `pending`
- **Priority**: high
- **Depends On**: None
- **Description**:
  - Modify `scripts/auto-settle-owner.mjs`: CSV/Payoneer XLS export NEVER writes `settled=true` / `status='completed'` / `RevenueEvent.status='settled'`. Replace with `PayoutInstruction.status = INSTRUCTION_GENERATED` (via Prisma) or return export only, no DB status changes.
  - Remove any `status: executionResult.method === 'manual_csv' ? 'export_ready' : 'paid_out'` and adjacent `settled: true` patterns in auto-settle-owner.
  - In `src/autonomous-daemon.mjs`, audit `runAutoSettleOwner`, runTick payouts, auto-approve, auto-submit: disable any unconditional payout based solely on balance thresholds. Guard with explicit entitlement existence (Reconciled RevenueEvent) + reservation check before even creating batch.
  - In `src/api/external-payment-api.mjs`, remove ANY literal hard-coded fallback OWNER destinations (OWNER_PAYPAL_EMAIL, OWNER_BANK_IBAN, OWNER_CRYPTO_WALLET). Only use resolveBestPayoutRoute / OwnerAccount rows.
  - Comment out/disable fm.gateway.initiate* direct calls in ExternalPaymentAPI; replace with TODO throw requiring SettlementEngine.
- **Acceptance Criteria Addressed**: AC-1, AC-2, AC-9
- **Test Requirements**:
  - `rule` TR-1.1: `grep -R "export_ready.*settle\|manual_csv.*settled.*true\|settled.*=.*true.*csv\|balance.*>.*execute\|if.*balance.*threshold"` scripts src → 0 matching hits.
  - `rule` TR-1.2: `grep -R "OWNER_PAYPAL_EMAIL.*recipient\|OWNER_BANK_IBAN.*recipient\|OWNER_CRYPTO_WALLET.*recipient" src scripts` (payout execution paths, not config files) → 0 hits.
  - `rule` TR-1.3: `node scripts/auto-settle-owner.mjs --dry-run 2>&1 | grep -i "settled.*true\|completed.*status" → 0 matches`; assert only INSTRUCTION_GENERATED/export_ready status (no settled=true).
- **Notes**: Run tests early to confirm P0 disabling works; this is the immediate fail-close safeguard.

## Task 2: Create single durable SettlementEngine submitForSettlement with 13-stage state machine + UNKNOWN state
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - Create `src/lib/settlement/SettlementEngine.ts` implementing submitForSettlement(request: SettlementRequest) as the ONE durable entry point.
  - Define State enum strictly ordered: `REVENUE → RECONCILED → OWNER_ENTITLEMENT → PAYOUT_PROPOSAL → POLICY → RESERVATION → INSTRUCTION → IDEMPOTENCY → PROVIDER_SUBMITTED → PROCESSING → UNKNOWN → PROVIDER_RECONCILED → CONFIRMED → SETTLED` plus explicit REJECTED, CANCELLED, QUARANTINED, EXPIRED terminal non-success states.
  - submitForSettlement performs:
    (a) verify caller authorization + OWNER_EXEC_UNLOCK (>=16 chars) when SWARM_LIVE.
    (b) policy/limits check (per OwnerPaymentConfig split %, velocity cap, netToOwner > 0)
    (c) Prisma transaction with row-level lock (SELECT ... FOR UPDATE) on RevenueEvent(s) or PayoutItem entitlement source; create `RESERVATION` by writing reservationId, reservationTime on entitlement rows. Fail if another worker holds reservation or entitlement already settled/payout linked.
    (d) Durable Idempotency row: create or return existing PayoutItem by unique key (ownerAccountId + entitlementSourceRef). Duplicate → return same PayoutItem.id (no 2nd provider call).
    (e) Create PayoutBatch+PayoutItem+PayoutEvent(REVENUE→RECONCILED→...RESERVATION→INSTRUCTION→IDEMPOTENCY) in same tx.
    (f) Provider submission: async call provider rail (PayPal Payouts API, etc.) ONLY after provider rail ensureReady() passes. On SUCCESS → PROVIDER_SUBMITTED (write externalRef = provider batch/item id). On failure → REJECTED.
    (g) Append-only PayoutEvent written for EVERY attempted/cancelled transition.
  - finalizeSettlement(externalRef, providerStatus): call PROVIDER_RECONCILED → (if SUCCESS status) → CONFIRMED → (if proofHash + externalRef non-synthetic + matches amount/currency) → SETTLED. Write proofHash=sha256(settledAt|amount|currency|externalRef). Store in PayoutItem.proofHash + OwnerSettlement.proofHash + write AuditLedger.
  - UNKNOWN state: state machine explicitly defines UNKNOWN as `PROCESSING` with `lastProviderUpdateAt < now - N hours`.
- **Acceptance Criteria Addressed**: AC-3, AC-4, AC-5, AC-6, AC-7, AC-10, AC-13
- **Test Requirements**:
  - `rule` TR-2.1: State transitions invalid attempt (SETTLED → PROPOSAL) → throws INVALID_TRANSITION; PayoutEvent does NOT contain invalid stateTo.
  - `rule` TR-2.2: UNKNOWN state condition satisfied (PROCESSING > 4h no update) → watchdog (Task 4) transitions PROCESSING → UNKNOWN correctly.
  - `rule` TR-2.3: Two concurrent submitForSettlement calls (Vitest concurrent) against same RevenueEvent → count rows === 1; provider mock.calls.length === 1; one gets RESERVATION_CONFLICT.
  - `rule` TR-2.4: submitForSettlement twice with same idempotency key → returns same PayoutItem.id both calls; provider called 1x only.
  - `rule` TR-2.5: finalizeSettlement attempt (externalRef=PB-123 synthetic) → throws (DB triggers or app guard). finalizeSettlement attempt with externalRef missing → throws. finalizeSettlement with live externalRef after CONFIRMED → SETTLED written + proofHash present + non-empty sha256.
  - `rubric` TR-2.6: PayoutEvent sequence completeness. Dimension: append-only fidelity; scale 1-5; 1=no events; 3=some; 5=every state transition writes PayoutEvent, eventSequence strictly++; threshold>=4; evidence=DB rows after test scenario.

## Task 3: Route all 3 entry points (autonomous daemon, ExternalPaymentAPI, settlement-engine finalize) through SettlementEngine
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 2
- **Description**:
  - `src/api/external-payment-api.mjs`: Refactor. Each method (requestAutoSettlement, requestPayPalPayout, requestBankWireTransfer, requestCryptoTransfer, requestPayoneerTransfer):
    - validates items exist, runs ensureLiveAndSafe, enforceOwnerDirective, estimateEconomics → then calls SettlementEngine.submitForSettlement() with explicit idempotency key. Return PayoutBatch/PayoutItem ids. Direct fm.gateway.initiate* calls: REMOVED or replaced with SettlementEngine internal only.
  - `src/autonomous-daemon.mjs` runTick/runAutoSettleOwner:
    - Remove any emit commands that create payouts/settlements; replace with:
      (1) Fetch reconciled RevenueEvents (status=verified/reconciled, no payoutItemId yet, amount>0).
      (2) For each, call submitForSettlement(ownerAccount, revenueEventId, idempotencyKey=base44_entity+row_id)
    - Remove auto-approve auto-submit loops that don't go through SettlementEngine reservation.
    - For legacy Base44 offline writes: only allowed for logging, not provider submission.
  - `src/lib/settlement-engine.ts` finalizeSettlement:
    - Delegate to SettlementEngine.finalizeSettlement(). Keep wet-run path as simulation only (never provider). Remove direct settleAndPayout() call at finalizeSettlement (L569). replace with SettlementEngine.
  - Ensure every payout path (daemon, API, wet-run) writes Prisma PayoutBatch/PayoutItem/PayoutEvent (no SQLite, no local-only state).
- **Acceptance Criteria Addressed**: AC-3, AC-11
- **Test Requirements**:
  - `rule` TR-3.1: grep `ExternalPaymentAPI` class body → `fm\.gateway\.initiate[A-Z]` → 0 occurrences (except possibly inside SettlementEngine itself, which is correct).
  - `rule` TR-3.2: grep `runTick\|runAutoSettleOwner` → directly call `submitForSettlement` or delegate to SettlementEngine only; 0 occurrences of `approve-batch.*submit\|auto-submit\|payout.*submit.*if.*balance` bypass logic.
  - `rule` TR-3.3: Finalize settlement path → writes PayoutEvent PROVIDER_RECONCILED and CONFIRMED / SETTLED only through SettlementEngine.finalizeSettlement.
  - `rule` TR-3.4: All payout entry points create ONE PayoutBatch+PayoutItem (same request from 3 entry points does not double payout — idempotency enforced).

## Task 4: Provider reconciliation worker + stuck payout watchdog (UNKNOWN state transition, escalation, retry gate)
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 2
- **Description**:
  - Create `src/lib/settlement/ProviderReconciliationWorker.ts`:
    - `runOnce()`: query PayoutItem where status ∈ {PROCESSING, PROVIDER_SUBMITTED, UNKNOWN}. For each:
      (i) compute elapsed since lastProviderUpdateAt.
      (ii) If PROCESSING and elapsed > H (PayPal/Crypto: 4h; Bank/Payoneer:24h): UNKNOWN transition, create PaymentEscalation severity L1.
      (iii) If UNKNOWN and elapsed further > L2 threshold (double H): PaymentEscalation L2 + quarantine QUARANTINED.
      (iv) Call rail-specific reconcile method:
        - PayPal: `GET /v1/payments/payouts-items/:item_id` (Payout item status)
        - Crypto/Bitget: get-withdrawal-status (by id)
        - Payoneer: check payout status (by reference)
        - Bank wire / Attijari: check CMI/Attijari status if configured; else UNKNOWN persists (manual only).
      (v) Map provider response → PayoutItem state:
            SUCCESS/COMPLETED → PROVIDER_RECONCILED → CONFIRMED
            REJECTED/FAILED/RETURNED → REJECTED (allows new idempotency key later for retry)
            PROCESSING/PENDING → PROCESSING + update lastProviderUpdateAt
            NO_RESPONSE → keep UNKNOWN, increment retryEscalationCount.
  - Retry rule: No automatic retry ever. A rejected EXPIRED payout requires explicit new idempotency key.
  - Watchdog also scans for stuck reservations older than 10 min (reservation hold timeout → release reservation for another worker if PROVIDER_SUBMITTED never reached).
  - Integrate runOnce into daemon tick (autonomous-daemon.mjs already calls runTick; add reconciliation as another sub-step).
- **Acceptance Criteria Addressed**: AC-5, AC-8, AC-12
- **Test Requirements**:
  - `rule` TR-4.1: Seed PayoutItem PROCESSING, lastProviderUpdateAt = now - 5h (PayPal). Reconciliation worker runs. Assert status === UNKNOWN, PaymentEscalation row with severity L1 exists.
  - `rule` TR-4.2: Mock provider GET returns SUCCESS for UNKNOWN item. Worker runs. Assert status transitions PROVIDER_RECONCILED → CONFIRMED. No retry.
  - `rule` TR-4.3: Mock provider returns REJECTED → state → REJECTED written, can create NEW idempotency key for retry (new key does not collide with existing).
  - `rule` TR-4.4: PROCESSING → no update for > 2*H → UNKNOWN then L2 escalation + QUARANTINED transition.
  - `rubric` TR-4.5: Rail coverage. Dimension: reconcile method per rail completeness; scale 1-5; 1=no rails; 3=some (PayPal); 5=all 5 rails (PayPal, Crypto, Payoneer, Bank Wire, Wise/Stripe) have reconcile methods implemented (or fail-closed RAIL_NOT_CONFIGURED). threshold>=4.

## Task 5: Ensure every rail ensureReady() fail-closed + RAIL_NOT_CONFIGURED, and wire truth-guards middleware
- **Status**: `pending`
- **Priority**: medium
- **Depends On**: Task 2
- **Description**:
  - Audit each rail wrapper (PayPal payout: `src/paypal-api.mjs`; Crypto/Bitget `src/crypto/binance-client.mjs`/`src/crypto/crypto-rail.mjs`/`src/finance/ExternalGatewayManager.mjs`; Payoneer; Bank/Attijari; Stripe/Wise): ensure an `ensureReady(): Promise<void>` method exists that throws `RAIL_NOT_CONFIGURED` error if env vars are placeholder/missing. SettlementEngine MUST call ensureReady() before any provider submission.
  - Wire truth-guards.ts Prisma middleware (already present) to validate PayoutItem updates:
    - beforeUpdate PayoutItem: if update sets status ∈ {SETTLED, COMPLETED, verified} → require `externalRef != null && !externalRef.startsWith('PB-') && !externalRef.startsWith('INSTRUCTION_') && proofHash != null`. Otherwise throw.
    - Ensure middleware also enforces invalid state transitions using the same State enum validation from SettlementEngine.
  - Verify OwnerAccount registry: `resolveBestPayoutRoute` only ever returns routes from OwnerAccount DB rows where `isActive=true && verifiedAt != null`.
  - Drop literal OWNER_* destination fallbacks in payout execution paths (anywhere payouts are executed, not config files).
- **Acceptance Criteria Addressed**: AC-9, AC-14, AC-15
- **Test Requirements**:
  - `rule` TR-5.1: For each of 5 rails, set env vars to placeholder `<YOUR_...>`/undefined → call ensureReady() → throws RAIL_NOT_CONFIGURED.
  - `rule` TR-5.2: Try prisma.payoutItem.update({ where:{id:x}, data:{status:'completed', externalRef:null}}) → truth-guard middleware throws.
  - `rule` TR-5.3: resolveBestPayoutRoute with active OwnerAccount rows seeded → route.source === 'db' (not env). No literal fallback string destinations written in payout execution code (non-config source files).
  - `rubric` TR-5.4: Truth guard 3-layer depth. Dimension: Prisma middleware + SQL triggers + resolver layer re-check; scale 1-5; 1=no guard; 3=middleware only; 5=Prisma middleware active, SQL BEFORE triggers (Neon) present, resolver layer (API route handlers) also re-check before returning settled write; threshold>=4.

## Task 6: Vitest test suite — exactly-once semantics, idempotency, crash/restart
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Tasks 2-5
- **Description**:
  - Add test file `tests/settlement-engine-exactly-once.test.ts` (or `src/lib/settlement/__tests__/*.test.ts` — follow project convention).
  - Test suite:
    T1. exactly-once happy path: submitForSettlement once → provider called 1x, 1 PayoutItem → SETTLED → proofHash present.
    T2. duplicate submitForSettlement same RevenueEvent twice in parallel → reservation conflict on one; 1 PayoutItem row only; provider.calls.length === 1.
    T3. crash mid-flight simulation: kill process after RESERVATION but before PROVIDER_SUBMITTED. Restart: reservation released after 10min watchdog; worker retry creates exactly one provider call → one settled item.
    T4. duplicate idempotency: same idempotency key 2 invocations → same PayoutItem.id returned; provider 1x only.
    T5. UNKNOWN timeout: advance time (vi.useFakeTimers) → PROCESSING > H → watchdog runs → UNKNOWN + escalation L1.
    T6. reconciliation decides SUCCESS → UNKNOWN → CONFIRMED → SETTLED (no retry).
    T7. reconciliation decides REJECTED → REJECTED → new idempotency key → 2nd PayoutItem (retried) SETTLED → total 2 rows (both different idempotency keys) provider.calls.length === 2.
    T8. synthetic externalRef attempt finalizeSettlement('PB-sim') → THROW or DB trigger block.
    T9. CSV/export: run auto-settle dry-run mode → PayoutItem.status only INSTRUCTION_GENERATED (no settled=true written).
    T10. Every state transition (successful or failed attempt) writes at least one PayoutEvent row.
- **Acceptance Criteria Addressed**: AC-1 through AC-16
- **Test Requirements**:
  - `rule` TR-6.1: `npx vitest run tests/settlement-engine-exactly-once.test.ts --reporter=verbose` → all 10 tests passing.
  - `rubric` TR-6.2: End-to-end exactly-once crash/restart fidelity. Dimension scale 1-5; 1=double payout; 3=some protection without full watchdog; 5=50 concurrent crash-restart simulations each yield exactly 1 provider call + 1 settled payout; threshold>=4.
  - `rubric` TR-6.3: Coverage breadth. Dimension: AC coverage via tests; scale 1-5; 1=few; 3=some; 5=every rule AC has at least 1 passing test; threshold>=4.

## Task 7: Run audit:truth, npm typecheck, linting, and verify old SQLite/local deprecated paths no longer reachable
- **Status**: `pending`
- **Priority**: medium
- **Depends On**: Task 6
- **Description**:
  - Run `npm run audit:all` → typecheck + truth-invariant-audit + url-guard-self-test + verify-i8-gates → pass.
  - Run existing npm scripts `npm run typecheck`, `npm run lint` → clean.
  - Grep old deprecated paths: any `require('sqlite`|`better-sqlite3|lowdb` in payout/settlement code → assert 0 (Prisma Postgres only).
  - Grep `settled.*=.*true` in any script that has `csv\|xls\|export` context → 0 (Task 1 already verified; double-check).
  - grep any remaining independent settlement backend (another server file) that writes payouts (outside Prisma, deprecated SQLite → confirm removed or commented).
- **Acceptance Criteria Addressed**: AC-1, AC-2, AC-14
- **Test Requirements**:
  - `rule` TR-7.1: `npm run audit:all` → exit 0.
  - `rule` TR-7.2: `npm run typecheck` → 0 errors; `npm run lint` → 0 new errors introduced (pre-existing allowed).
  - `rule` TR-7.3: `grep -R "sqlite\|better-sqlite\|lowdb" src scripts` in settlement paths → 0 matches (excluding test fixtures).

