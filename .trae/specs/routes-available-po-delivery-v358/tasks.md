# SPEC MODE #5: Routes Available + PO Delivery v3.5.8 — PLAN (tasks.md)
## Serial Atomic Tasks T0 → T9 | 10 AC Coverage | ≥2 TR/Task | SANS-DB 0 Deps

### Global Binding Constraints (NG1-NG7 + NFR)
- NG1: SANS-DB — 0 Prisma/Postgres/Neon write calls, audit-only READ
- NG2: 0 fabrication — `out/received/**` + `exports/bank-wire/**` write count=0 permanent Phone Rule
- NG3: 0 huissier comms — 0 smtp/email/send patterns
- NG4: 0 Prisma schema changes
- NG5: Pure `deriveBalance` — prev=this_run identity guarantee AC7
- NG6: NO Trae sandbox git push — commit local ONLY, push runbook HORS sandbox only
- NG7: 0 stale master reuse — fresh SHA256 computed each run
- NFR: Runner imports ONLY `node:fs` / `node:crypto` / `node:path` / `node:url` / `node:child_process` → 0 external deps
- NFR: Runtime <90s, idempotent, `maskSecret(prefix4…suffix2 len=NN)` for any sensitive value printed

---

## T0: BOOTSTRAP — HMAC Chain Init + Workspace Sanity
**Objective**: Truncate fresh audit log, verify workflow mtime order baseline, create output directories with 0 stale artifacts.
**ACs Covered**: AC8 (partial), AC9 (partial)
**Testable Rules (TRs ≥2)**:
1. TR0.1: Fresh HMAC NDJSON → `data/out/routes-po-v358.ndjson` line count = 0 AFTER T0 completes (truncated, no stale lines from prior runs)
2. TR0.2: Workflow baseline mtime → `mtime(spec.md) < mtime(tasks.md)` → true (strict spec→tasks order)
3. TR0.3: Report dir initialized → `reports/routes-po-v358/` non-gitkeep file count = 0 (0 stale artifacts)
**Outputs**:
- `data/out/routes-po-v358.ndjson` (0-byte truncated, ready for HMAC chain append)
- `reports/routes-po-v358/` directory created

---

## T1: OWNER Routes Inventory 6×3 Grid Build
**Objective**: Generate 6 preset × 3 column (preset_ready / rail_ready / proof_ready) inventory, with SKIP reasons ≥20 chars for 15+ cells (missing creds + unblock condition explicit).
**ACs Covered**: AC1
**Testable Rules (TRs ≥2)**:
1. TR1.1: 6 preset rows present → IDs exactly: `[ATTIJARI_RIB182_SALAIRE, ATTIJARI_RIB372_DETTE, BC_LU24_RIB646_SOUVERAIN, BC_LU24_RIB646_OPERATIONS, PAYONEER_B2B_BUFFER, USDC_ARBITRUM_L2_WALLET]`
2. TR1.2: SKIP reason integrity → ≥15 cells contain SKIP string length ≥20 chars (no empty FALSE; list exact missing credentials + signataire unblock condition)
3. TR1.3: Dry-run rail marker → Row 6 (USDC_ARBITRUM_L2_WALLET) `rail_ready` cell EXACT string = `✅ DRY-RUN OK (0 external calls, math-eligible only)`
4. TR1.4: Preset fallback consistency → All 6 `preset_ready` cells = `✅ FALLBACK REGISTRY (hardcoded NG1 SANS-DB)`
**Outputs**:
- `reports/routes-po-v358/01_routes_inventory_6x3.md` (markdown table)
- `reports/routes-po-v358/02_skip_reasons_detailed.md` (per-cell breakdown of missing creds + unblock steps)

---

## T2: Local Working Copy Commit (NG6 Compliant: Local ONLY)
**Objective**: Commit mid-run reports + runner to local git, capture before/after SHA, verify canonical commit message prefix.
**ACs Covered**: AC3
**Testable Rules (TRs ≥2)**:
1. TR2.1: SHA delta applied → `BEFORE_SHA (T2 start) ≠ AFTER_SHA (T2 end)` → true (commit succeeded)
2. TR2.2: Commit message canonical → `git log -1 --pretty=%s` starts with EXACT prefix: `"feat(v358): routes auto-inventory + USDC Arb L2 dryRun + PO honest delivery v3.5.8"`
3. TR2.3: Private exclusion → `git diff --name-only HEAD~1 | grep -c "^.swarm/"` → 0 (no private hands-free config committed)
4. TR2.4: Remote unchanged NG6 → `git rev-parse https-origin/main 2>$null` == BEFORE_SHA (no push attempted inside sandbox)
**Outputs**:
- `reports/routes-po-v358/03_commit_snapshot.md` (BEFORE_SHA, AFTER_SHA, commit msg, diff stats)

---

## T3: Push Runbook HORS Sandbox Generation
**Objective**: Generate Admin PS runbook for push OUTSIDE Trae sandbox, 3 mandatory sections, NG6 lock/MSYS2 bypass compliant.
**ACs Covered**: AC4
**Testable Rules (TRs ≥2)**:
1. TR3.1: 3 sections present → EXACT headers: `## A. Prérequis (Admin PowerShell HORS Trae)`, `## B. Étapes d'exécution (6 pas)`, `## C. Template de vérification SHA`
2. TR3.2: Credential helper bypass → Section B Step 4 contains EXACT substring: `git -c credential.helper=manager-core fetch https-origin`
3. TR3.3: No in-sandbox push pattern → Runbook contains 0 occurrences of `git push https-origin main`
4. TR3.4: SHA equality template → Section C includes: `LOCAL_SHA=<T2 AFTER_SHA> | REMOTE_SHA=$(git rev-parse https-origin/main) | EQUALITY=$([ $LOCAL_SHA == $REMOTE_SHA ] && echo OK || echo FAIL)`
**Outputs**:
- `reports/routes-po-v358/04_push_runbook_hors_trae.md`

---

## T4: Gate Matrix Snapshot + Dry-Run Route #1 Calculation
**Objective**: Compute G1-G4 gate status, run SANS-DB dry math BC646→USDC Arb, resolve L2 CEX rail, build idempotency key, 0 side effects.
**ACs Covered**: AC2
**Testable Rules (TRs ≥2)**:
1. TR4.1: Release math PASS → `HELD_BC646_USD = 63.67 ≥ RELEASE_OVERRIDE_USD = 60.00` → Δ=3.67 USD, `release_eligible_dry = true`
2. TR4.2: Rail resolve correct → return object: `rail_class="L2_CRYPTO_DIRECT_CEX"`, `preferredRail="arbitrum"`, `dest_wallet_eip55="0xA46225a984E2B2B5E5082E52AE8d8915A09fEfe7"` (EIP-55 checksum valid)
3. TR4.3: Idempotency key format → matches REGEX `^AUTO-RELEASE-BC646-\d{14}$` (YYYYMMDDHHMMSS, unique per run)
4. TR4.4: 0 side effects → status EXACT = `"DRY_RUN_OK_NO_SIDE_EFFECTS_NO_REAL_CEX_CALL"` + 0 network child processes (curl/wget/fetch count=0)
5. TR4.5: Honest gate matrix → G1=FAIL(<8 secrets), G2=FAIL(DATABASE_URL len<120), G3=FAIL(Binance KEY missing), G4=FAIL(UNLOCK len<43)
**Outputs**:
- `reports/routes-po-v358/05_gate_matrix_snapshot.md` (G1-G4 statuses)
- `reports/routes-po-v358/06_route1_dryrun_execution.md` (math, rail, idempotency, status)

---

## T5: 3-Way Grid Refresh (Preset × Rail × Proof Readiness)
**Objective**: Update baseline 3-way grid (all SKIP) to reflect row6 DRY-RUN rail OK, all proof SKIP NG2 phone rule marker.
**ACs Covered**: AC5
**Testable Rules (TRs ≥2)**:
1. TR5.1: Rail column correct → Row 6 `rail_ready = ✅ DRY-RUN OK`; 5 other rows = `❌ SKIP: <reason ≥20 chars>`
2. TR5.2: Proof column NG2 → All 6 `proof_ready` cells contain EXACT substring: `❌ SKIP: ng2_phone_rule_no_fabrication_pending_real_pod_file`
3. TR5.3: Valid markdown table → Header `| Preset Account | preset_ready | rail_ready | proof_ready |` + 6 data rows, no malformed pipes
4. TR5.4: Cross-ref consistency → All SKIP reasons match `02_skip_reasons_detailed.md` (0 inconsistencies)
**Outputs**:
- `reports/routes-po-v358/07_3way_grid_refresh.md`

---

## T6: PO Honest Delivery Report (3/3 POs, NG2 0 Fabrication)
**Objective**: Load 3 PO JSONs, cross-ref carrier manifest 2026-08-31, compute realistic ETA ranges, assign EN_TRANSIT status, verify 0 proof files fabricated.
**ACs Covered**: AC6
**Testable Rules (TRs ≥2)**:
1. TR6.1: 3 POs loaded → IDs exactly: `[SWARM-PO-2026-001, SWARM-PO-2026-002, SWARM-PO-2026-003]`, each with recipient, carrier, ETA_min/max, status
2. TR6.2: Carrier manifest alignment →
   - PO001 (Hind Casa 12150) → Jumia Logistics (7/10 manifest share)
   - PO002 (Younes Bouznika 13100) → Aramex Morocco (91/397 manifest share)
   - PO003 (Bachir Rabat Agdal) → Aramex Morocco (5/15 manifest share)
3. TR6.3: ETA realistic Morocco domestic →
   - PO001 Casa intra-urban: 2026-10-08 → 2026-10-12 (3-7j)
   - PO002 Bouznika semi-rural: 2026-10-10 → 2026-10-15 (5-10j)
   - PO003 Rabat intercity: 2026-10-09 → 2026-10-14 (4-9j)
4. TR6.4: Status honest → All 3 status EXACT prefix = `"EN_TRANSIT pending_proof_attendu_"` + ETA_max date
5. TR6.5: NG2 0 fabrication → `count(out/received non-gitkeep) BEFORE == AFTER (0=0)` AND `count(exports/bank-wire non-gitkeep) BEFORE == AFTER (0=0)`
**Outputs**:
- `reports/routes-po-v358/08_po_delivery_honest_report.md` (3-row table + carrier/ETA breakdown)

---

## T7: Zero-Loss Identity Guarantee (Pure deriveBalance)
**Objective**: Run pure `deriveBalance` twice on identical dataset, verify prev=this_run identity (Δ=0), bucket split 10/40/30/20 exact, 0 negative balances.
**ACs Covered**: AC7
**Testable Rules (TRs ≥2)**:
1. TR7.1: Identity guarantee → Run deriveBalance 2x (runA/runB) on same 6-presets dataset → for all 6 rows: `runA[i].available == runB[i].available` AND `runA[i].credits == runB[i].credits` (Δ=0, 1e-2 tolerance)
2. TR7.2: Bucket split exact → `SUM(10% salaire + 40% dette + 30% souverain + 20% operations) = 100.00%` (fixed 2 decimals, no rounding drift)
3. TR7.3: Solvency check → `min(available across 6 presets) ≥ 0.00` (no overdraws, fail-closed liquidity)
4. TR7.4: Pure function → `deriveBalance` body has 0 fs.write / 0 process spawn / 0 network calls
**Outputs**:
- `reports/routes-po-v358/09_zero_loss_identity_audit.md` (identity table, bucket split, solvency check)

---

## T8: HMAC Audit Chain Integrity Verification
**Objective**: Validate NDJSON log format, ≥12 lines, 3 random sample HMAC recalc match, monotonic timestamps.
**ACs Covered**: AC8
**Testable Rules (TRs ≥2)**:
1. TR8.1: Chain length → `data/out/routes-po-v358.ndjson` line count ≥ 12 (10 task lines + 2 bootstrap/close minimum)
2. TR8.2: Format compliance → All lines match regex `^[A-Z0-9_]+\|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\|.*$` (step|ISO8601 ts|_pStr pipe-delimited)
3. TR8.3: 3 sample HMAC recalc PASS → Lines 4/8/12 (1-indexed): compute HMAC-SHA256(_pStr, fallback key `SWARM-AUDIT-DUMMY-KEY-V358-000000000000`) → 3/3 match stored hash
4. TR8.4: Monotonic time → For i=2→N: `ts(line i) ≥ ts(line i-1)` (no time travel)
**Outputs**:
- `reports/routes-po-v358/10_hmac_chain_integrity.md` (line count, format, 3 samples, monotonicity)

---

## T9: Final Master SHA256 + AC Synopsis Verdict
**Objective**: Verify workflow mtime order, scan 0 secret leaks, compute master SHA of 10 reports, generate 10-AC PASS verdict table.
**ACs Covered**: AC9, AC10
**Testable Rules (TRs ≥2)**:
1. TR9.1: Workflow fidelity mtime (strict monotonic AC9) → `mtime(spec.md) < mtime(tasks.md) < mtime(01_routes_inventory.md) < mtime(11_ac_synopsis.md)` → true
2. TR9.2: 0 secret leak (AC10) → Grep pattern `(sk-[A-Za-z0-9]{32}|api[_-]?key|secret[_-]?key|DATABASE_URL=|BINANCE_API_|OWNER_EXEC_UNLOCK=)` across runner + 11 reports → match count=0
3. TR9.3: Master SHA valid → `SHA256(concat(01→10 report files in order))` = 64 hex chars, written to `master_sha256.txt`
4. TR9.4: AC synopsis green → 10-row table: 10/10 Verdict=PASS, rubric ≥1.5/2, total ≥18/20
**Outputs**:
- `reports/routes-po-v358/master_sha256.txt` (64-hex SHA)
- `reports/routes-po-v358/11_ac_synopsis_verdict.md` (10-AC verdict table)
- `.trae/specs/routes-available-po-delivery-v358/review.md` (outline placeholder for SP5 independent review)

---

## SP3 APPROVAL GATE (Post-Tasks)
After T0→T9 plan complete, NOTIFY signatory with:
1. `spec.md` path
2. `tasks.md` path
3. Explicit approval request: *"Approved the given files for autonomous routes + PO delivery runner execution"*
→ SP3 gate PASS ONLY on explicit user approval string (no implicit).
