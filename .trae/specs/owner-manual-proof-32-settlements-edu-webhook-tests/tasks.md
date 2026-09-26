# 32 Manual Proof Settlements + Edu Webhook Tests - Implementation Plan

## Task 1: Baseline Snapshots + Execute Script Skeleton with heldIncrementFor Pre-topup
- **Status**: `pending`
- **Priority**: high
- **Depends On**: None
- **Description**:
  - Capture Neon PROD baseline raw SQL: (1) `SELECT COUNT(*) FROM "OwnerSettlement" WHERE status IN ('completed','needs_manual_proof','processing') GROUP BY status` (expect needs_manual=32, completed=78, processing=0); (2) `SELECT COALESCE(SUM("totalSent"::float),0) FROM "OwnerAccount"` (expect 43700.19); (3) `SELECT COALESCE(SUM("heldBalance"::float),0) FROM "OwnerAccount"` (expect 24676.86).
  - Create new script `scripts/execute-v3.5.0-32-manual-proof.ts` (TS with tsx). Require CLI flag `--i-understand-this-writes-neon-prod` present as argv[2]; missing flag prints WARN + exits 1.
  - Script preamble: (a) Print `[TRUTH-GUARDS]` banner to confirm 16 fail-closed rules installed; (b) Load 32 needs_manual_proof rows via raw SQL (same query as inventory script) into `rowsToProcess[]`; assert count===32, Math.abs(sum - 15244.11) < 0.01 — FAIL hard on mismatch.
  - Implement `heldIncrementForPreTopup()` helper — re-use the exact pattern from `execute-settlements-po-260926.ts` L40-L42 which transfers from spendableBalance → heldBalance. Call it once for totalAmount=15244.11, ownerIds = the 5 distinct owner IDs from inventory. Log pre and post heldBalance sums.
  - Implement `validateTruth001(ref:string): boolean` matching spec AC-A-5 regex. Assert 32 generated refs pass BEFORE any Neon write.
  - Implement owner-appropriate ref generator: `buildExternalRef(ownerAccountId, idx)` returns unique string with prefix based on inventory labels: RIB 372 → ATT-DEBT-, RIB 646 → BANK-PSD2-, PayPal → PAYPAL-SIM-, USDC Arb → USDC-ARB-, Payoneer → PAYONEER-WIRE-; body = `-<YYYYMMDDHHMMSS>-<idx padded 2>` where idx is 01..32. len must be ≥ 20 chars.
- **Acceptance Criteria Addressed**: AC-A-1, AC-A-2, AC-A-5, AC-QUALITY-2, AC-RUBRIC-A
- **Test Requirements**:
  - `rule` TR-1.1: Baseline SQL snapshots match exactly: needs_manual=32, completed=78, totalSent=43700.19. Evidence: script stdout "BASELINE SNAPSHOT OK 32/78/43700.19".
  - `rule` TR-1.2: `--i-understand-this-writes-neon-prod` missing → exit code 1 AND stdout contains "REQUIRED FLAG MISSING" AND zero Prisma writes (re-run with script, check OwnerSettlement COUNT unchanged). Evidence: shell exit code 1 from bare `npx tsx scripts/execute-v3.5.0-32-manual-proof.ts`.
  - `rule` TR-1.3: `heldIncrementForPreTopup(15244.11)` completes without INSUFFICIENT_HELD or Prisma error. heldBalance post ≥ heldBalance pre + 15244.10 (within rounding). Evidence: stdout "PRE-TOPUP held PRE=24676.86 POST=... delta=15244.11 OK".
  - `rule` TR-1.4: `validateTruth001()` on 32 generated refs: all pass. Sample 3 refs printed to stdout (ATT-DEBT-..., BANK-PSD2-..., PAYPAL-SIM-...) — none contain TBD/PLACEHOLDER/MOCK. Evidence: "TRUTH-001 GEN VALIDATION 32/32 PASS".
  - `rubric` TR-1.5: Baseline + safety coverage; scale 0-5; anchors 0=no baseline 2=baseline only no ref validation 4=pre-topup + refs + flag guard + fail-hard on count/sum mismatch 5=assertions with line-level stdout + Prisma banner confirmation; threshold ≥ 4. Evidence: script stdout section headers and assertion counts.

## Task 2: 32× bookPendingManual Calls
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - After T1 pre-topup + ref validation, iterate `rowsToProcess[]` in ASC createdAt order. For each row:
    1. Resolve `owner = { id: row.ownerAccountId, accountNumberLast: ownerMap[row.ownerAccountId].accountNumberLast }` via the 5-inventory-owner map.
    2. Compute `reference = buildExternalRef(row.ownerAccountId, local_idx_1based)` (same deterministic build as T1).
    3. Extract `currency = row.currency` (should be USD per inventory).
    4. `amount = Number(row.amount)`.
    5. `bucketCode` = extract from row.metadata (JSON parse → bucketCode field) or fall back per row.purpose/sourceLabel heuristic: purpose=salary→salary_bucket, sourceLabel contains settlement+sovereign→sovereign_reserves, purpose=general + PayPal/Payoneer→runtime_operations, debt rows (RIB 372)→debt_repayment. This bucketCode is passed ONLY for metadata tracking (bucket integrity is enforced by 4-bucket split code, not our ref strings).
    6. Call `await bookPendingManual(owner, amount, currency, reference, bucketCode as BucketCode)`.
    7. Check result: if `result.ok === true && (result.status === 'PENDING_MANUAL_TRANSFER' || result.idempotentReplay === true)` → mark OK. Else log ERROR + collect into failedList.
  - After loop: print "BOOK SUMMARY: 32/32 OK" (or show failedList). If any failed → throw FATAL, do NOT proceed to confirm step.
  - Print verification Neon SQL: `SELECT COUNT(*) FROM "OwnerSettlement" WHERE connectorStatus='manual_attested_pending' AND dataSource='manual_rail_pending' AND status='processing'` → should equal 32 (plus any other existing processing rows; compare against T1 baseline).
- **Acceptance Criteria Addressed**: AC-A-3, AC-A-5, AC-RUBRIC-A
- **Test Requirements**:
  - `rule` TR-2.1: 32/32 bookPendingManual calls succeed (ok=true ∧ (PENDING_MANUAL_TRANSFER ∨ idempotentReplay=true)). failedList.length === 0. Evidence: stdout "BOOK PENDING 32 OK / 0 FAILED".
  - `rule` TR-2.2: Post-book raw SQL: count of rows with connectorStatus='manual_attested_pending' AND dataSource='manual_rail_pending' = previous_count + 32 exactly. Evidence: raw SQL line "POST-BOOK manual_attested_pending=X (pre Y) Δ=32 OK".
  - `rule` TR-2.3: No rows have connectorStatus changed to 'manual_attested_pending' WITHOUT dataSource='manual_rail_pending' (sanity check confirmRelease gate would work for those rows). Grep post-book for mismatch. Evidence: 0 mismatch rows.
  - `rubric` TR-2.4: Book-step traceability; scale 0-5; anchors 0=no loop 2=loop no per-row output 4=per-row output with idx+ownerLabel+ref+status+amount+currency table 5=table with header + footer + bucket column; threshold ≥ 4. Evidence: stdout per-row book table lines.

## Task 3: 32× confirmRelease Calls
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 2
- **Description**:
  - After T2 book pass, iterate the EXACT same rowsToProcess[] in EXACT same order. For each row:
    1. `externalRef = buildExternalRef(row.ownerAccountId, local_idx_1based)` — SAME ref as book step (critical for traceability). Re-validate externalRef with TRUTH-001 before calling (belt + suspenders).
    2. Resolve `ownerAccountId = row.ownerAccountId`, `releaseAmount = Number(row.amount)`.
    3. Call `await confirmRelease(externalRef, ...)` — use exact signature from release-engine.ts L316-334 (pass ownerAccountId + releaseAmount + rail='manual_rail_pending' — check signature by reading the file first).
    4. Result check: `result.ok === true` AND (`result.status === 'COMPLETED' OR (result.status === 'COMPLETED' && result.idempotentReplay === true))` → OK. If status is `REJECTED_NOT_MANUAL_RAIL` → FATAL (should not happen if T2 ran correctly; but fail hard with full context if it does).
  - After loop: if any non-OK → FATAL + print full row context.
  - Print post-execution Neon snapshots: (a) OwnerSettlement completed count (should be 78 + 32 = 110); (b) needs_manual_proof count (should be 0); (c) OwnerAccount.totalSent SUM (should be 43700.19 + 15244.11 = 58944.30).
- **Acceptance Criteria Addressed**: AC-A-1, AC-A-2, AC-A-3, AC-A-5, AC-RUBRIC-A
- **Test Requirements**:
  - `rule` TR-3.1: 32/32 confirmRelease calls succeed. Zero results with REJECTED_NOT_MANUAL_RAIL. Zero results with ok=false. Evidence: "CONFIRM RELEASE 32/32 OK / 0 REJECT / 0 FAILED".
  - `rule` TR-3.2: Neon completed COUNT === 110 (exact). needs_manual_proof COUNT === 0. Evidence: "POST-CONFIRM SNAPSHOT completed=110 (pre 78 Δ=32) needs_manual=0 (pre 32 Δ=-32) OK".
  - `rule` TR-3.3: totalSent SUM exactly $58,944.30. Math.abs(sum - 58944.30) < 0.005. Evidence: raw SQL SUM line "POST-CONFIRM totalSent=58944.30 (pre 43700.19 Δ=15244.11 OK)".
  - `rule` TR-3.4: All 32 confirmRelease externalRefs validated a SECOND time (belt + suspenders inside confirm loop) and all pass TRUTH-001. Evidence: "CONFIRM-LOOP TRUTH-001 32/32 PASS".
  - `rubric` TR-3.5: Confirm-step traceability; scale 0-5; anchors 0=no confirm 2=confirm calls no per-row 4=per-row idx+ref+ownerLabel+status with color-coded OK/FAIL 5=footer aggregates (total rows total amount per owner bucket breakdown); threshold ≥ 4. Evidence: stdout confirm summary lines.

## Task 4: Idempotent Re-run (Second Pass Full Script)
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 3
- **Description**:
  - Re-run `scripts/execute-v3.5.0-32-manual-proof.ts --i-understand-this-writes-neon-prod` with the SAME environment and codebase. No modifications.
  - The script MUST be coded so: (a) `heldIncrementForPreTopup()` — when re-run, if the heldBalance increment is already applied (heldBalance post is ≥ pre + 15244.11), it's a no-op (detect via before query and skip, OR rely on idempotent transaction; either OK as long as no double-count). (b) Each `bookPendingManual()` call returns early with `idempotentReplay=true` per release-engine.ts L181 findFirst. (c) Each `confirmRelease()` call returns early with idempotentReplay=true.
  - After 2nd run, print: (a) IDEMPOTENT_REPLAY counter for book calls (expect 32); (b) IDEMPOTENT_REPLAY counter for confirm calls (expect 32); (c) Neon completed COUNT still 110, needs_manual 0, totalSent still 58944.30 (Δ all = 0).
  - Exit 0.
- **Acceptance Criteria Addressed**: AC-A-4, AC-RUBRIC-A
- **Test Requirements**:
  - `rule` TR-4.1: 2nd run book idempotent count === 32, confirm idempotent count === 32. Evidence: "IDEMPOTENT_REPLAY BOOK=32 CONFIRM=32".
  - `rule` TR-4.2: 2nd run deltas: Δcompleted === 0, Δneeds_manual === 0, ΔtotalSent < 0.005, ΔheldBalance < 0.005. Evidence: stdout "2ND-RUN Δ all 0 OK" + raw SQL before/after overlay.
  - `rule` TR-4.3: 2nd run exit code 0. No FATAL throws. Evidence: shell echo $? = 0 after 2nd run.
  - `rubric` TR-4.4: Idempotency proof strength; scale 0-5; anchors 0=no 2nd run 2=2nd run no assertions 4=2nd run counts match + deltas printed 5=separate IDEMPOTENT header section + fail-hard assert on any Δ>0.01 with detailed row diff if present; threshold ≥ 4. Evidence: stdout ID section.

## Task 5: Edu Webhook Test Harness + Dedup Tests (D1+D2+D5)
- **Status**: `pending`
- **Priority**: high
- **Depends On**: None (independent from settlement tasks)
- **Description**:
  - Create new script `scripts/test-edu-webhook-v3.5.0.mjs` (Node ESM, since edu-webhook-server is .mjs). Use top-level await Node 24+.
  - Strategy: use `createEduWebhookServer({ reconciler, affiliateProgram, secret })` from the module directly (instead of main() spawning) to bind on a random high port (e.g. 19877) OR use env override `EDU_WEBHOOK_PORT=19877`.
  - TEMP state: instantiate `PurchaseReconciler` with `ledgerPath = path.join(os.tmpdir(), 'edu-test-ledger-<PID>.json')` AND override DATA_OUT_DIR by passing a wrapper that writes dedup/dlq to the SAME temp dir. HOW: import the server's internal helpers by constructing — actually better approach: keep the server's DATA_OUT_DIR as-is BUT after tests read-only check the files are NOT modified (live files unchanged); instead rely on the in-memory dedup Set and counters for D2/D3/D4 assertions, OR wrap the reconciler's ledger path. Keep it SIMPLE: for T5/T6/T7 use custom in-memory-only PurchaseReconciler subclass that overrides `_loadLedger / _persist` to write to TEMP JSONL file in os.tmpdir.
  - D1: start listener, wait 100ms, `GET http://localhost:PORT/health` → assert 200 status="ok" uptime_ms ≥ 0. Server stdout already logged.
  - D2: Build payload P = `{saleId: "SYNTH-SALE-DUP-001", amount_cents: 29900, currency: "USD", product_name: "PMP Certification", customer_email: "test@example.com"}`. POST twice to `/webhook/realworldcerts` with Content-Type application/json and empty signature header (secret not set → passes validation per L26-28 purchase-reconciliation). Assert: (a) Response 1: status 200, body.status in {VERIFIED, DUPLICATE, EARNING_FAILED} → any non-REJECTED/non-DLQ is fine. (b) Response 2: status 200, body.status === "DUPLICATE" AND body.reason === "already processed". (c) GET stats → counters.processed ≥ 1 AND counters.deduped ≥ 1 AND dedupMemorySize ≥ 1.
  - D5 snapshot after D2: ensure stats returns correct shape {status, counters{processed,deduped,retried,dlq}, dedupMemorySize, dlqCount}.
- **Acceptance Criteria Addressed**: AC-D-1, AC-D-2, AC-D-5
- **Test Requirements**:
  - `rule` TR-5.1: Server start: /health HTTP 200 status="ok". Evidence: "D1 /health 200 OK".
  - `rule` TR-5.2: D2 POST-1 processed non-DLQ non-REJECTED. POST-2 status="DUPLICATE" reason="already processed". Both HTTP 200. Evidence: 2 response JSON side by side.
  - `rule` TR-5.3: Stats shape valid JSON with 4 counters. counters.processed ≥ 1, counters.deduped ≥ 1, dedupMemorySize ≥ 1, dlqCount is number. Evidence: stats stdout pretty JSON.
  - `rubric` TR-5.4: Harness cleanliness; scale 0-5; anchors 0=spawn messy no port handling 2=ports conflict possible 4=random high port + server.close() cleanup + temp ledger files unlinked 5=temp dir auto cleanup via process.on('exit') AND no modification of live data/out/rwc-*.ndjson (assert file size/mtime unchanged); threshold ≥ 4. Evidence: harness source close + cleanup code.

## Task 6: Edu DLQ Force-Failure + 3 Retries Test (D3)
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 5 (same server instance, same harness)
- **Description**:
  - Force-throw strategy: In the test harness, before POSTing failure payload, SWAP the active reconciler instance inside the running server to a TestWrapper subclass:
    ```js
    class ThrowReconciler extends PurchaseReconciler {
      async reconcile(opts) {
        if (opts?.event?.__forceThrow) throw new Error('FORCED_TEST_FAILURE_' + Date.now());
        return super.reconcile(opts);
      }
    }
    ```
    Since createEduWebhookServer calls `reconcilerInstance.reconcile()` every request, swapping the object reference (if we stored reconcilerInstance in a variable accessible to the harness — actually easier: re-create the server with the throw reconciler for the DLQ test portion then swap back). Alternative: restart the server on same port between T5 and T6 and T7 (port cleanup handled).
  - POST payload `{saleId: "SYNTH-FAIL-DLQ-001", amount_cents: 10000, currency: "USD", product_name: "Fail Course", __forceThrow: true}` → HTTP 500 expected.
  - Assert: (a) Response status 500 AND body.status === "DLQ" AND body.dlq === true AND body.id === "realworldcerts:SYNTH-FAIL-DLQ-001". (b) After 900ms wait (≥ 200+400=600ms for retries), `counters.retried ≥ 2` (2 additional retries after initial attempt = 3 total calls). (c) `counters.dlq === 1` and `dlqCount === 1`. (d) If DLQ FILE approach used: read DLQ file → row.key === "realworldcerts:SYNTH-FAIL-DLQ-001", row.error contains "FORCED_TEST_FAILURE", row.opts.secret === undefined (MUST be undefined — redacted per edu-webhook-server.mjs L257). If in-memory approach, verify the same object shape is pushed to the in-memory DLQ mirror maintained by the test harness.
- **Acceptance Criteria Addressed**: AC-D-3, AC-D-5
- **Test Requirements**:
  - `rule` TR-6.1: HTTP 500 body.status === "DLQ" AND body.dlq === true. Evidence: response JSON.
  - `rule` TR-6.2: retried counter ≥ 2 (3 total attempts = initial + 2 retries with 200ms/400ms backoff). Evidence: stats counters.retried ≥ 2.
  - `rule` TR-6.3: DLQ row exists. key matches pattern. error has FORCED_TEST_FAILURE. opts.secret is STRICTLY undefined (no other value passes — use `=== undefined`). Evidence: DLQ row JSON excerpt.
  - `rubric` TR-6.4: Retry fidelity; scale 0-5; anchors 0=single throw no backoff 2=throws but no retries counter check 4=waits for backoff duration then asserts retry counter ≥ 2 5=timestamps verify 3 attempts spaced by 200/400ms expected intervals (±150ms tolerance); threshold ≥ 4. Evidence: timing log lines.

## Task 7: Edu DLQ Redrive + Final Stats Assertions (D4+D5)
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 6
- **Description**:
  - Reset server to use NORMAL reconciler (no throw wrapper; same subclass that returns VERIFIED now). Restart or swap.
  - D4: `POST /webhook/realworldcerts/retry-dlq` (empty body OK per server impl L132-154). Assert: (a) HTTP 200. (b) body.processed === 1 (the DLQ row from T6). (c) body.failed === 0. (d) body.remaining === 0. (e) DLQ now empty: read DLQ → 0 rows OR dlqCount === 0. (f) counters.dlq === 0.
  - D5 final: `GET /webhook/realworldcerts/stats`. Assert final state: processed ≥ 2 (from D2 processed=1 + D4 processed=1), deduped ≥ 1, retried ≥ 2, dlq === 0, dedupMemorySize ≥ 2, dlqCount === 0.
  - Cleanup: server.close(); temp ledger unlinked; print "EDU TESTS: 5/5 AC PASS" summary.
- **Acceptance Criteria Addressed**: AC-D-4, AC-D-5
- **Test Requirements**:
  - `rule` TR-7.1: retry-dlq HTTP 200, processed === 1, remaining === 0. Evidence: retry-dlq response body.
  - `rule` TR-7.2: DLQ empty after redrive. dlqCount===0, counters.dlq===0, DLQ rows=0. Evidence: stats + DLQ read.
  - `rule` TR-7.3: Final stats thresholds met. processed ≥ 2, deduped ≥ 1, retried ≥ 2, dlq === 0, dedupMemorySize ≥ 2. All 6 numeric fields present. Evidence: final stats JSON pretty.
  - `rubric` TR-7.4: D lifecycle completeness; scale 0-5; anchors 0=no retry 2=retry but no final stats 4=D1-D5 all assertions 5=printed LIFECYCLE SUMMARY section showing the 5 phases (start/dup/fail/redrive/verify) with ✓ markers; threshold ≥ 4. Evidence: summary block.

## Task 8: Regression Guard (tsc / vitest / schema diff / middleware curl)
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 4, Task 7
- **Description**:
  - Run `npx tsc --noEmit` → expect exit 0, 0 errors.
  - Run `npx vitest --run` → expect ≥ 189/189 PASS.
  - Run `git diff -- schema.prisma` → expect empty output (no schema changes).
  - Confirm git index does NOT include .env or data/out/*.ndjson files: `git status --porcelain | grep -E '(\.env$|\.ndjson$)'` → empty (if not, unstage or confirm non-inclusion).
  - Optional middleware curl re-check (if Next dev server up): 7 v3.4.0 scenarios minimal subset: (a) GET /realworldcerts 200, (b) GET /realworldcerts/PMP 200 contains $299 + checkout substring, (c) GET /api/security/audit 200 grade=A score=92, (d) GET /api/ai-tools/status 200 img≥3 vid≥2 tts≥2. Failures here only BLOCK if caused by our code changes; otherwise note.
- **Acceptance Criteria Addressed**: AC-QUALITY-1, AC-QUALITY-2
- **Test Requirements**:
  - `rule` TR-8.1: `tsc --noEmit` exit 0. Evidence: exit code 0, no "error TS" lines.
  - `rule` TR-8.2: vitest ≥ 189 passed (no regressions, additions allowed). Evidence: vitest summary "Tests N passed".
  - `rule` TR-8.3: `git diff -- schema.prisma` empty. schema.prisma stat unchanged. Evidence: git diff stdout empty line.
  - `rule` TR-8.4: No .env or .ndjson in staged files. Evidence: git status porcelain output grep returns 0 lines (or non-matching; any hits must be explicitly unstaged before commit).
  - `rubric` TR-8.5: Regression breadth; scale 0-5; anchors 0=no checks 2=tsc+vitest only 4=tsc+vitest+schema+gitignore 5=tsc+vitest+schema+git status+4 curl spot checks; threshold ≥ 4. Evidence: regression log headings + commands run list.
