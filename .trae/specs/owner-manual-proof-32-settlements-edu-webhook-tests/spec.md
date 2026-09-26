# 32 Manual Proof Settlements + Edu Webhook Tests PRD (v3.5.0)

## Overview
- **Summary**: Execute v3.4.0 changelog backlog items (a) and (d): (A) Attest and release 32 `OwnerSettlement` rows currently at `status='needs_manual_proof'` totaling $15,244.11 against Neon PROD using the required MAD 2-step `bookPendingManual → confirmRelease` flow with TRUTH-001 compliant external references; and (D) validate the v3.3.5 Edu webhook server implementation with synthetic tests covering start/stop, dedup DUPLICATE responses, the 3× exponential-backoff retry/DLQ mechanism, the retry-dlq endpoint, and the stats counters endpoint.
- **Purpose**: (A) Move 32 stalled settlements out of `needs_manual_proof` limbo so the treasury `totalSent` ledger is complete and the 4 pre-set owner accounts receive the allocated funds ($3,150 debt/MA, $10,738.41 sovereign/LU, $682.70 PayPal, $127.30 USDC, $545.70 Payoneer). (D) Provide executable proof that the edu webhook dedup + DLQ + 3x backoff architecture behaves correctly under duplicate, permanent-failure, and recovery scenarios before any live RWC traffic hits port 9877.
- **Target Users**: (1) Ops admin releasing the 32 manual settlements and verifying the treasury balance-sheet movements; (2) Dev ops engineer confirming edu webhook reliability via the synthetic test harness; (3) Auditor verifying idempotency, TRUTH guard compliance, and ledger integrity post-execution.

## Goals
1. **A1-A5 (32 Settlement Execution)**: All 32 `needs_manual_proof` rows transition through `bookPendingManual` → `connectorStatus='manual_attested_pending'` → `confirmRelease(externalRef, ...)` → `status='completed'` with `totalSent` increment exactly $15,244.11, zero REJECTED_NOT_MANUAL_RAIL rows, fully idempotent on re-run, and every generated externalRef passes TRUTH-001 (len≥6, no placeholder substrings).
2. **D1-D5 (Edu Webhook Tests)**: Standalone `node src/edu/edu-webhook-server.mjs` process listens on EDU_WEBHOOK_PORT (default 9877); two identical POSTs return processed=true + DUPLICATE responses; a forced-failure POST writes to DLQ; retry-dlq redrives it; stats endpoint returns 4 numeric counters (processed/deduped/retried/dlq).
3. **Quality Guard**: tsc --noEmit 0 errors, vitest ≥ 189/189 pass, no schema.prisma edits, 16 TRUTH guards still reported installed on Prisma client.

## Non-Goals
- **NO schema.prisma changes ever** (project hard pin). Code-only + DML-only.
- **NO owner account creation or config edits**. 6 pre-existing OwnerAccounts used verbatim (182 salary MA / 372 debt MA / 646 Banking Circle LU sovereign / PayPal / Payoneer / USDC Arbitrum).
- **NO 4-bucket split modifications**: sovereign_reserves=30, runtime_operations=20, salary_bucket=10, debt_repayment=40 (sum exactly 100, fail-closed).
- **NO paid purchases or real payment submissions**. Edu tests are fully synthetic with test-local temp ledger files.
- **NO .env or *.ndjson data commits** (exclude via .gitignore rules already in place).
- **NO edits to v3.4.0 middleware CSP / CSRF gate / rate-limit logic** unless required (scope creep forbidden).
- **NO changes to v3.4.0 provider registry / RWC SSR pages / security audit endpoint** (already green in review checkpoint 38/38).

## Background & Context
- **Treasury current state (post v3.3.4 + v3.4.0, Neon PROD confirmed)**:
  - OwnerAccount.totalReceived = $8,718.30 USD
  - OwnerAccount.totalSent = $43,700.19 USD
  - OwnerAccount.heldBalance = $24,676.86 USD
  - OwnerSettlement.completed = 78 rows | PayoutItem.completed = 23 rows
  - OwnerSettlement.needs_manual_proof = 32 rows totaling $15,244.11
- **Inventory of 32 needs_manual_proof rows (Neon PROD raw SQL 2026-09-26)**:
  | ownerId | label | count | sum USD | rail |
  |---|---|---|---|---|
  | e6ce7a7c…be3ab6 | Moroccan Bank RIB 372 (debt MA) | 7 | $3,150.00 | ATT-DEBT (MAD manual) |
  | 01afb980…25a516a | Banking Circle RIB 646 (sovereign LU) | 19 | $10,738.41 | BANK-PSD2 (LU) |
  | b8e59fe5…9300d7 | PayPal Business | 2 | $682.70 | PAYPAL-SIM |
  | 3ac169ef…d5796 | USDC on Arbitrum | 2 | $127.30 | USDC-ARB |
  | 4ee28082…e67f6 | Payoneer Supplier | 2 | $545.70 | PAYONEER-WIRE |
  All 32 rows have `connectorStatus='not_configured'` AND `dataSource='internal_ledger_only'`, meaning: (a) calling confirmRelease directly on them will 100% hit `REJECTED_NOT_MANUAL_RAIL`; (b) `bookPendingManual` MUST run FIRST to mutate connectorStatus→'manual_attested_pending' and dataSource→'manual_rail_pending' before confirmRelease can proceed (confirmed by release-engine.ts L315-334 gate).
- **v3.3.4 execute-script deliberate-skip pattern**: `scripts/execute-settlements-po-260926.ts` L57 loaded the 32 rows via OR clause `[{status:'needs_manual_proof'}, {status:'processing'}]`, but the per-row confirm loop (L>116) only processed rows with `connectorStatus === 'manual_attested_pending'` — intentionally skipping the 32 because they had not been operator-booked yet. The 2-step book→confirm sequence for these 32 is the missing pass.
- **MAD manual rail 2-step contract (release-engine.ts L174-334)**:
  1. `bookPendingManual(owner, amount, currency, reference, bucketCode)` → idempotent via findFirst on (ownerAccountId, status=processing, connectorStatus=manual_attested_pending, purpose=release, sourceLabel match, amount, currency). Creates OwnerSettlement status='processing', connectorId='attijariwafa_mad_manual_operator_mobile', connectorStatus='manual_attested_pending', dataSource='manual_rail_pending'.
  2. `confirmRelease(externalRef, ...)` → gate requires `pending.status === processing AND pending.connectorStatus === manual_attested_pending AND pending.dataSource === 'manual_rail_pending'`. Fulfillment: sets status='completed', decrements heldBalance, increments totalSent/txCount, appends AuditLedger row. Idempotent: same ref + same owner + matched amount returns early (no-op).
- **Edu webhook server v3.3.5 implementation snapshot**: `src/edu/edu-webhook-server.mjs` exposes: (D1) standalone main() listener on EDU_WEBHOOK_PORT default 9877 with PID; (D2) dedup via `processedIds` Set loaded from `data/out/rwc-dedup.ndjson` persisted on boot; 3× exponential backoff `reconcileWithRetry` 200ms/400ms/800ms around `PurchaseReconciler.reconcile()`; permanent failure on 3rd attempt appends to `data/out/rwc-dlq.ndjson` and returns HTTP 500 {status:"DLQ"}; `POST /webhook/realworldcerts/retry-dlq` iterates DLQ rows, calls reconcile, removes successes and decrements dlq counter; `GET /webhook/realworldcerts/stats` returns `{counters:{processed,deduped,retried,dlq}, dedupMemorySize, dlqCount}`.

## Functional Requirements

### FR-A-1: Pre-topup heldBalance before 32-row release
- Before any bookPendingManual or confirmRelease calls, compute the exact batch total ($15,244.11) and call the `heldIncrementFor(ownerAccountIds, sum)` helper (scripts/execute-settlements-po-260926.ts L40 pattern) to transfer the release sum from spendableBalance to heldBalance atomically. This prevents `INSUFFICIENT_HELD` shortfall when confirmRelease subtracts from held (spendable is currently negative — that's acceptable and not a fail gate; heldIncrementFor tops-up held from spendable and lets the Prisma atomic decrement guard proceed).

### FR-A-2: 32× bookPendingManual with owner-appropriate reference prefixes
- For each of the 32 rows, call `bookPendingManual(owner, amount, currency, reference, bucketCode)` where:
  - `owner` = resolved OwnerAccount via the row's ownerAccountId (real columns: id + accountNumberLast)
  - `amount` / `currency` = copied verbatim from the row (all USD per inventory)
  - `reference` = unique, len≥6, no placeholders, owner-appropriate prefix:
    * RIB 372 debt MA → `ATT-DEBT-<YYYYMMDDHHMMSS>-<idx>`
    * RIB 646 sovereign LU → `BANK-PSD2-<YYYYMMDDHHMMSS>-<idx>`
    * PayPal Business → `PAYPAL-SIM-<YYYYMMDDHHMMSS>-<idx>`
    * USDC Arbitrum → `USDC-ARB-<YYYYMMDDHHMMSS>-<idx>`
    * Payoneer → `PAYONEER-WIRE-<YYYYMMDDHHMMSS>-<idx>`
  - `bucketCode` = inferred from row.sourceLabel / row.metadata (fallback: use sourceLabel prefix mapping per inventory)
- Every bookPendingManual result must have either (ok=true ∧ status=PENDING_MANUAL_TRANSFER ∧ (createdNew=true OR idempotentReplay=true)).

### FR-A-3: 32× confirmRelease with TRUTH-001 compliant externalRefs
- AFTER all 32 bookPendingManual succeed, iterate the exact same 32 rows in identical order and call `confirmRelease(externalRef, ...)` where `externalRef` = SAME owner-appropriate prefix + SAME timestamp/idx as the bookPending reference (this proves operator traceability: the reference the book step declares is what the confirm step fulfills).
- Before submit, every externalRef is validated against TRUTH-001 regex: `len≥6` AND does NOT match `\b(TBD|PLACEHOLDER|PENDING|MOCK|TEST|REPLACE|DEMO_?ONLY|SELFTEST|LIVE.?TEST|PROOFHASH.?VERIFY)\b/i`. Any failing ref is rejected with FATAL before any Neon write.
- Every confirmRelease result must have `ok=true ∧ status=COMPLETED ∧ (released=true OR idempotentReplay=true)`. Zero results with `REJECTED_NOT_MANUAL_RAIL`.

### FR-A-4: Idempotent re-run (second pass)
- After the first successful run, re-run the EXACT SAME script with the EXACT SAME args. Second pass MUST produce: (a) 0 newly created OwnerSettlement rows; (b) 0 mutations to OwnerAccount.totalSent / heldBalance; (c) exit 0; (d) every bookPendingManual call returns idempotentReplay=true; (e) every confirmRelease call returns idempotentReplay=true. Evidence: Neon raw SQL COUNT/SUM before vs 2nd run delta=0.

### FR-D-1: Standalone edu webhook server PID lifecycle
- `node src/edu/edu-webhook-server.mjs` can start as a detached process (listening EDU_WEBHOOK_PORT=9877 default), writes `[EDU] Webhook listener on :9877` to stdout, and responds `GET /health` HTTP 200 `{status:"ok", uptime_ms}`. After tests finish, SIGTERM to the PID cleanly closes the socket.
- Tests use a TEMPORARY `DATA_OUT_DIR` subdirectory (e.g. `data/out/test-edu-<pid>/`) by setting env overrides for dedup/dlq ledger paths OR use `createEduWebhookServer()` options with a test-local PurchaseReconciler instance pointing at temp files — so live `data/out/rwc-*.ndjson` is NEVER modified.

### FR-D-2: Dedup DUPLICATE response
- `POST /webhook/realworldcerts` with body `{saleId:"SYNTH-SALE-001", amount_cents:29900, currency:"USD", product_name:"PMP", ...}` (valid signature — EDU_WEBHOOK_SECRET unset so signature verification passes via verifyMainSiteWebhookSignature secret=null→true per purchase-reconciliation.mjs L26-28).
- 1st POST: response HTTP 200, body.status ∈ {VERIFIED, DUPLICATE} and 1st call processed=true.
- 2nd POST (identical body): response HTTP 200, body.status === "DUPLICATE" AND body.reason === "already processed" AND counters.deduped incremented by 1.

### FR-D-3: Permanent-failure DLQ append via 3× retries
- Pass a custom test reconciler into `createEduWebhookServer({ reconciler })` OR inject a test-only force-throw event property. Strategy: subclass PurchaseReconciler and override `reconcile()` to `throw new Error("FORCED_TEST_FAILURE")` when `event.__forceThrow === true` on the 3 payloads. Ensure the reconcileWithRetry wrapper exhausts all 3 attempts (200ms + 400ms = 600ms wait + try) before the catch block appends to `rwc-dlq.ndjson`.
- After forced-throw POST, assert: (a) response HTTP 500 body.status === "DLQ"; (b) `readDlq().length === 1` AND dlq[0].error.includes("FORCED_TEST_FAILURE") AND dlq[0].key === "realworldcerts:SYNTH-FAIL-001" AND dlq[0].opts.secret === undefined (secret must be redacted from persisted DLQ row per edu-webhook-server.mjs L257); (c) stats counters.dlq === 1 AND counters.retried ≥ 2.

### FR-D-4: retry-dlq endpoint redrives and clears DLQ
- After D3, call `POST /webhook/realworldcerts/retry-dlq` with the default reconciler (no __forceThrow mode active → reconcile() now succeeds for replayed payload). Assert: response HTTP 200 body.processed ≥ 1 AND body.remaining === 0 AND readDlq().length === 0 AND counters.dlq === 0.

### FR-D-5: Stats endpoint returns 4 numeric counters
- `GET /webhook/realworldcerts/stats` HTTP 200 JSON contains `{counters:{processed:number, deduped:number, retried:number, dlq:number}, dedupMemorySize:number, dlqCount:number}`. After D2-D4 run: processed ≥ 2, deduped ≥ 1, retried ≥ 2, dlq === 0, dedupMemorySize ≥ 2, dlqCount === 0.

## Non-Functional Requirements
- **NFR-1 No schema changes**: `git diff -- schema.prisma` after implementation is empty string.
- **NFR-2 TRUTH-001 100% pass rate**: 32 externalRefs + 32 book references = 64 strings all pass TRUTH-001 (len≥6, placeholder regex returns false). Evidence: assertion loop in the execute script prints 64/64 PASS.
- **NFR-3 Idempotency guarantee**: Any subset of book/confirm calls re-run with identical args never creates duplicate OwnerSettlement rows, never double-subtracts heldBalance, never double-increments totalSent. Second full-pass exit code 0 with stdout "IDEMPOTENT_REPLAY: 32/32 book + 32/32 confirm".
- **NFR-4 Zero test pollution**: Edu tests use either (a) `createEduWebhookServer()` custom options with temp ledger path / custom reconciler, OR (b) env-overridden temp dir. Never touch live `data/out/rwc-dedup.ndjson` or `data/out/rwc-dlq.ndjson`. Restore state after tests via cleanup.
- **NFR-5 Baseline pass**: `tsc --noEmit` exit 0. `vitest --run` 189/189 PASS exactly OR more (test additions allowed, deletions forbidden).
- **NFR-6 Middleware preservation**: Middleware CSP/CSRF/rate-limit byte-count unchanged. v3.4.0 7 curl scenarios (RWC SSR pages, rate limit 429, CSRF 403 mismatch, CSP nonce+strict-dynamic, security audit grade A, AI tools status) continue passing when re-verified.
- **NFR-7 Neon PROD write safety**: Execute script accepts a `--i-understand-this-writes-neon-prod` required flag; missing flag prints WARN and exits 1 with NO Neon write. Prints BEFORE and AFTER raw SQL totals (OwnerSettlement.completed count, OwnerAccount.totalSent SUM) so stdout is an audit trail.

## Constraints
- **Technical**: Node 24+ Neon, Prisma 7.10.0 adapter-pg, tsx for .ts script execution; NO npm install new packages (reuse existing deps). Neon PROD DATABASE_URL only; never use shadow DB or migrate for this scope.
- **Business**: 32 rows MUST book AND confirm; partial success is a FAIL (if N<32 rows complete, roll back via script error report and treat as blocked; partial complete is NEVER marked "done" for review). 4-bucket 30/20/10/40 split NOT modified.
- **Dependencies**: Reuse `src/lib/treasury/release-engine.ts` bookPendingManual/confirmRelease verbatim signatures; reuse `scripts/execute-settlements-po-260926.ts` heldIncrementFor pattern; reuse `src/edu/edu-webhook-server.mjs` createEduWebhookServer() factory for tests (new minimal wrapper script only).

## Assumptions
- (1) heldIncrementFor L40 pattern remains valid: transferring from spendableBalance → heldBalance works even when spendableBalance is negative (because held+spend is conserved; held just becomes larger). Prisma atomic update for heldBalance increment + spendable decrement accepts negative spendable values (not a fail gate) — confirmed by v3.3.4 run (spendable went negative there as well).
- (2) OwnerAccount rows 182/372/646/PayPal/Payoneer/USDC Arb exist and have valid IDs matching the 5 inventory owner IDs (confirmed by SQL join — all 32 rows successfully joined owner rows).
- (3) For edu force-failure testing: the strategy of wrapping PurchaseReconciler (subclass with __forceThrow check) and passing it to createEduWebhookServer({reconciler}) will be accepted by the HTTP handler code (confirmed: reconciler parameter at L102-110 uses `?? new PurchaseReconciler()` default, so override works).
- (4) EDU_WEBHOOK_SECRET env var is UNSET during test runs → signature check passes per purchase-reconciliation L26-28 `if (!secret) return true`. If it's set, test wrapper sets a known secret and signs payloads correctly.
- (5) Payload signature validation bypass via null secret is safe for test harness only — live deployments require EDU_WEBHOOK_SECRET (already enforced by docs).

## Acceptance Criteria

### AC-A-1: 32 OwnerSettlements completed post-run
- **Type**: `rule`
- **Given**: Neon PROD connected with DATABASE_URL; execute script run with --i-understand flag.
- **When**: Run Neon raw SQL `SELECT COUNT(*) FROM "OwnerSettlement" WHERE status='completed'` AFTER run; also run `SELECT COUNT(*) FROM "OwnerSettlement" WHERE status='needs_manual_proof'`.
- **Then**: completed count === 78 + 32 = 110 (exact). needs_manual_proof count === 0 (exact).
- **Pass Condition**: completedCount === 110 AND needsManualCount === 0.
- **Evidence**: Raw SQL stdout of both counts pre-run vs post-run (4 lines of output).

### AC-A-2: totalSent increment exactly $15,244.11
- **Type**: `rule`
- **Given**: Pre-run OwnerAccount.totalSent SUM (raw SQL COALESCE SUM float) = $43,700.19 baseline.
- **When**: Post-run recompute SUM.
- **Then**: Δ = exactly 15244.11 USD. post = 43700.19 + 15244.11 = 58944.30.
- **Pass Condition**: Math.abs(postTotalSent - 58944.30) < 0.005 (cent-level precision).
- **Evidence**: Two raw SQL lines with pre $43,700.19 and post $58,944.30 values; Δ printed.

### AC-A-3: Zero REJECTED_NOT_MANUAL_RAIL rows
- **Type**: `rule`
- **Given**: Every confirmRelease call captured its returned status.
- **When**: Grep the execute-script stdout for "REJECTED_NOT_MANUAL_RAIL" or "REJECTED_" or count non-COMPLETED/non-idempotentReplay results.
- **Then**: Zero rows rejected; every confirmRelease call returns either (status=COMPLETED AND released=true) OR (status=COMPLETED AND idempotentReplay=true).
- **Pass Condition**: confirmSuccessCount === 32 AND rejectedCount === 0.
- **Evidence**: Per-row confirm summary table; 32/32 PASS count line in stdout.

### AC-A-4: Idempotent re-run — zero mutations
- **Type**: `rule`
- **Given**: First run completed AC-A-1..3 PASS.
- **When**: Re-run the EXACT same script with the EXACT SAME --i-understand flag. Then recompute Neon completed count and totalSent SUM.
- **Then**: completed count and totalSent SUM are identical to post-first-run (Δ = 0 for both). Script stdout contains "IDEMPOTENT_REPLAY" markers for 32 book + 32 confirm calls.
- **Pass Condition**: Δcompleted === 0 AND ΔtotalSent < 0.005 AND script exit 0 AND grep IDEMPOTENT_REPLAY count === 64.
- **Evidence**: Second-run stdout excerpt showing IDEMPOTENT lines; post-2nd-run SQL identical to post-1st-run.

### AC-A-5: All externalRefs pass TRUTH-001
- **Type**: `rule`
- **Given**: Array of all 32 confirm-release externalRefs.
- **When**: Validate each with: `(len(ref) >= 6) AND NOT /\b(TBD|PLACEHOLDER|PENDING|MOCK|TEST|REPLACE|DEMO_?ONLY|SELFTEST|LIVE.?TEST|PROOFHASH.?VERIFY)\b/i.test(ref)`.
- **Then**: 32/32 refs PASS.
- **Pass Condition**: truth001Failures === 0.
- **Evidence**: Script validation block output "TRUTH-001 check 32/32 PASS" with per-owner ref samples (first 3 refs printed).

### AC-D-1: Edu webhook server starts and /health responds
- **Type**: `rule`
- **Given**: Test harness starts server via spawn or createEduWebhookServer + http.listen on port T.
- **When**: `GET http://localhost:T/health` sent after 1s settle.
- **Then**: HTTP 200. Body JSON contains status="ok" and uptime_ms ≥ 0. Stdout contains "Webhook listener on :".
- **Pass Condition**: HTTP 200 AND body.status === "ok" AND uptime_ms present.
- **Evidence**: curl stdout + server startup log lines.

### AC-D-2: Two identical POSTs → 1 VERIFIED + 1 DUPLICATE
- **Type**: `rule`
- **Given**: Server running. Same payload POSTed twice: `{saleId:"SYNTH-SALE-DUP", amount_cents:29900, currency:"USD", product_name:"PMP"}`.
- **When**: Response 1 and Response 2 captured; then GET /stats.
- **Then**: (a) Res1.status=200 AND res1.body.status ∈ {VERIFIED,DUPLICATE} and no "DUPLICATE" reason if first. (b) Res2.status=200 AND res2.body.status==="DUPLICATE" AND res2.body.reason==="already processed". (c) stats.counters.processed ≥ 1 AND stats.counters.deduped ≥ 1.
- **Pass Condition**: Res2 DUPLICATE + deduped counter ≥ 1.
- **Evidence**: Both response bodies side by side; stats snapshot.

### AC-D-3: Force-throw payload writes DLQ after 3 retries
- **Type**: `rule`
- **Given**: Server with custom reconciler subclass that throws "FORCED_TEST_FAILURE" when event.__forceThrow true.
- **When**: POST payload `{saleId:"SYNTH-FAIL-DLQ", amount_cents:10000, __forceThrow:true}`. After response, read DLQ file + GET /stats.
- **Then**: HTTP 500 body.status === "DLQ". DLQ file length ≥ 1. DLQ row key === "realworldcerts:SYNTH-FAIL-DLQ". DLQ row.error contains "FORCED_TEST_FAILURE". DLQ row.opts.secret is undefined (redacted). stats.counters.retried ≥ 2 AND stats.counters.dlq ≥ 1.
- **Pass Condition**: 500 DLQ response ∧ DLQ row matches ∧ retried≥2 ∧ secret redacted.
- **Evidence**: Response body; DLQ row JSON excerpt; stats counters.

### AC-D-4: retry-dlq endpoint redrives successfully
- **Type**: `rule`
- **Given**: After D3, DLQ contains exactly 1 row. Server now uses default reconciler (no force throw).
- **When**: `POST /webhook/realworldcerts/retry-dlq` (empty body). After response, GET /stats and re-read DLQ.
- **Then**: HTTP 200. body.processed === 1. body.remaining === 0. DLQ file empty. stats.counters.dlq === 0. stats.counters.processed incremented by 1 compared to D3-end state.
- **Pass Condition**: processed=1 remaining=0 AND DLQ empty AND dlq counter=0.
- **Evidence**: retry-dlq response; DLQ-file line count 0; stats snapshot.

### AC-D-5: Stats endpoint returns 4 required numeric counters
- **Type**: `rule`
- **Given**: Server at end of D1-D4 sequence.
- **When**: `GET /webhook/realworldcerts/stats`.
- **Then**: Response HTTP 200 JSON shape: `{status, counters{processed,deduped,retried,dlq}, dedupMemorySize, dlqCount}`. All 4 counter fields are finite integers ≥ 0. processed ≥ 2, deduped ≥ 1, retried ≥ 2, dlq === 0. Memory size ≥ 2; dlqCount === 0.
- **Pass Condition**: Shape matches AND all 4 counters are numeric AND thresholds met.
- **Evidence**: Response JSON pretty-printed.

### AC-QUALITY-1: tsc and vitest baseline pass
- **Type**: `rule`
- **Given**: Implementation complete; no TS errors expected.
- **When**: `tsc --noEmit` then `vitest --run`.
- **Then**: tsc exit 0; vitest exit 0; vitest ≥ 189/189 pass count.
- **Pass Condition**: tsc errors=0 AND vitestPass/total ≥ 189/189.
- **Evidence**: tsc stdout (empty or no error lines); vitest summary line "Tests 189 passed (189)".

### AC-QUALITY-2: No schema.prisma diff + TRUTH guards still installed
- **Type**: `rule`
- **Given**: Git clean index after adding/editing only permitted files.
- **When**: `git diff -- schema.prisma` AND run any Prisma-using script (e.g. inventory script) to inspect the "[TRUTH-GUARDS]" stdout banner.
- **Then**: schema.prisma diff is empty. Prisma client banner shows "Installed 16 fail-closed rules on Prisma client via $extends".
- **Pass Condition**: diff empty AND TRUTH guard banner printed with "16 fail-closed rules".
- **Evidence**: Git diff empty output; Prisma TRUTH-GUARDS banner line.

### AC-RUBRIC-A: Coverage and traceability (0-5)
- **Type**: `rubric`
- **Scale**: 0-5
- **Anchors**: 0 = no rows touched; 2 = partial 10 rows no idempotency test; 3 = 32 rows booked + confirmed but no held topup or no per-row stdout; 4 = all 32 rows complete with heldIncrementFor + before/after SQL diff + per-row stdout table with refs + prefix legend 5 owner buckets; 5 = 4 plus idempotency full rerun 64 IDEMPOTENT_REPLAY markers + TRUTH-001 64-ref verification block.
- **Pass Threshold**: ≥ 4
- **Evidence Source**: Execute-script stdout log length, headings for Before-SQL / After-SQL / per-row table / IDPOTENT pass block.

### AC-RUBRIC-D: Edu test harness completeness (0-5)
- **Type**: `rubric`
- **Scale**: 0-5
- **Anchors**: 0 = no test; 2 = manual curl only no server start; 3 = scripted 2-duplicate test only no DLQ; 4 = D1+D2+D3 passes (server + dedup + DLQ) no retry/stats assertions; 5 = D1-D5 full lifecycle AND cleanup restores temp state (no test files leaked, live ndjson untouched).
- **Pass Threshold**: ≥ 4
- **Evidence Source**: Test script source; stdout sequence of all 5 endpoints responses; cleanup log.
