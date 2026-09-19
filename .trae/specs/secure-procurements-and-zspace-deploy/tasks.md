# Secure Procurements + Space-Z Deploy Safety — Implementation Tasks

Dependencies: Task 1 (policy + model) → Tasks 2/3 (procurement + zspace independent) → Task 4 (tests) → Task 5 (review). Tasks 2 and 3 run in parallel once T1 is complete.

---

## Task 1: DisbursementPolicy Canonical + Procurement Budget Hardening
- **Status**: pending
- **Priority**: high
- **Parent AC**: AC-6 (DisbursementPolicy bucketPct=100 exactly, profile values), AC-2 (budget gate), AC-12 (audit chain)
- **Scope**: `src/lib/treasury/buckets.ts`, `src/lib/strict-enforcement/strict-procurement.ts`

### Changes
1. **`getDisbursementPolicy()` return shape**: `bucketPct: { sovereign_reserves:30, runtime_operations:20, salary_bucket:10, debt_repayment:40 }`. Sum must equal exactly 100.0 — throw `BUCKET_SUM_MISMATCH` if not equal, DO NOT drift-into-salary like line 73–76 did previously; fail-closed.
2. **`BUCKET_DEFAULT_PCT`**: delete `procurement_buffer:10` from the Record to avoid accidental 5-bucket sum != 100. `BUCKET_CODE enum/union`: keep codes but enforce that only the 4 canonical % appear in policy.bucketPct.
3. **Strict procurement helpers add**: in `strict-procurement.ts` export:
   - `function checkProcurementBudget(totalAmount:number, currency:string): Promise<{ok:boolean, code?:string, spendable:number, required:number}>` — queries `FundBucket WHERE code IN ('runtime_operations','procurement_buffer')` → `procurement_spendable = procurement_buffer_balance + floor(0.50 * runtime_operations_balance)` (per Q/A #3). If PO.totalAmount > procurement_spendable → `ok:false code:'BUDGET_EXCEEDED'`.
   - `function approvePurchaseOrderWithBudgetCheck(poId, approver): Promise<{approved:boolean, code?:string, receipt:POApproval}>` — wraps budget check + PO.status update → POApproval create + AuditLedger write.
4. **DisbursementPolicy sum test**: unit test `expect(getDisbursementPolicy().bucketPct.{sr+ro+sb+dr}.sum).toBe(100)`.
5. **Budget fail test**: set FundBucket mock values too low → expect(BUDGET_EXCEEDED).

### Test Requirements (TR)
- **TR-1.1 (rule)**: `getDisbursementPolicy().bucketPct` for 4 buckets sum exactly 100.0; mutate one value to 99 sum → throws BUCKET_SUM_MISMATCH.
- **TR-1.2 (rule)**: `checkProcurementBudget(amount > spendable)` → ok:false with code BUDGET_EXCEEDED.
- **TR-1.3 (rubric, threshold 4/5)**: Budget gate coverage = 4 if both pass+fail tested with receipt evidence; 5 if AuditLedger hash chain verified.

---

## Task 2: Procurement Security (PO idempotency + receipt idempotency + MA supplier hard-gate + 3-way mandatory)
- **Status**: pending
- **Priority**: high
- **Depends on**: Task 1
- **Parent AC**: AC-1, AC-3, AC-4, AC-5, AC-10, AC-12, AC-13
- **Scope**: `src/lib/strict-enforcement/strict-procurement.ts`, `src/lib/procurement/payment-gateway-router.ts`, `src/lib/procurement/index.ts`, `src/lib/procurement/pipeline.ts`

### Changes
1. **PO submit idempotency** (AC-1):
   - Add `createOrGetPurchaseOrder(data, callerIdempotencyKey?)`. Compute `defaultKey = sha256([data.poNumber, data.supplierId, String(data.totalAmount), data.currency, String(data.ownerInitiated)].join('|'))`; `callerKey || defaultKey`.
   - Write POApproval row with `action: 'submitted'` AND a side-payload `idempotencyKey` in AuditLedger.metadata.
   - On duplicate key: find AuditLedger where `entityType='purchase_order' AND metadata contains idempotencyKey` → return existing PO, no new rows written.
2. **Receipt confirmation idempotency** (AC-5):
   - Add `idempotencyKey` param to `ConfirmReceiptParams` (required). Compute default = sha256(procurementItemId + '|' + String(quantityReceived) + '|' + (proofHash||'')).
   - Look for prior AuditLedger row with same idempotencyKey in metadata; if found return prior ReceiptResult without writing update or audit; if NOT found proceed with current write logic.
3. **MA-supplier default hard gate** (AC-3):
   - `getPreferredSupplierForCategory(category, {allowInternationalFallback:'operator_approved'|'never'} = {allowInternationalFallback:'never'})`.
   - Query: `supplier WHERE isActive=true AND country='MA' AND totalDelivered>0 AND itemsWithDefect/totalDelivered < 0.15` filter. If 0 rows AND allowInternationalFallback != 'operator_approved' → throw `SupplierNotFound: no Moroccan suppliers. operator_approval required for international`.
   - If fallback: requires a POApproval row `action:'supplier_fallback_approved' performedBy:operator`.
4. **3-way-match mandatory before payout release** (AC-4):
   - `payoutReleaseGate` today calls `verifyTrackingPayload` first. Add call: `const threeWay = await runThreeWayMatch(...)`.
   - Gate: if threeWay.report.status !== 'PASS' → return `release_allowed:false, reason:'INCOMPLETE_THREE_WAY_MATCH'`, never silent.
5. **Fail-closed tests** (AC-10): all 5 gates (budget, supplier MA, 3-way, PO idem, receipt idem) have pass+fail unit tests.
6. **Append-only audits**: every mutation writes AuditLedger hash chain with previousHash findFirst-ordered DESC + entryHash=sha256(JSON payload), no update/delete on audit rows.

### Test Requirements
- **TR-2.1 (rule)**: same idempotencyKey PO create x2 → returns same id, POApproval count unchanged (1 row).
- **TR-2.2 (rule)**: same idempotencyKey receipt confirm x2 → same result, no extra AuditLedger row.
- **TR-2.3 (rule)**: supplier gate 0 MA rows + allowInternationalFallback=never → throws NO_MOROCCAN_SUPPLIER. With operator_approval + fallback approved POApproval row → succeeds with international supplier.
- **TR-2.4 (rule)**: 3-point fraud ok but no-three-way match → payoutReleaseGate returns INCOMPLETE_THREE_WAY_MATCH, release_allowed=false.
- **TR-2.5 (rubric ≥4/5)**: fail-closed coverage. 5 gates tested both sides.

---

## Task 3: Space-Z Deploy Pipeline + Healthz Route + Post-Deploy Smoke
- **Status**: pending
- **Priority**: high
- **Depends on**: Task 1 (only for package.json engines; mostly independent, parallel ok)
- **Parent AC**: AC-7, AC-8, AC-9, AC-11, AC-13
- **Scope**: `.github/workflows/deploy-space-z.yml`, new `src/app/api/healthz/route.ts`, existing `src/app/api/deploy/status/route.ts` (add /record PUT endpoint)

### Changes
1. **deploy-space-z.yml fixes** (AC-7):
   - L62 setup-node: `node-version: 24` (was 22).
   - `trigger-deploy`: replace echo-only body with real curl call. Env `SPACEZ_DEPLOY_HOOK: ${{ secrets.SPACEZ_DEPLOY_HOOK }}`. Fail-closed if not set: `[ -z "${SPACEZ_DEPLOY_HOOK}" ] && echo "::error::SPACEZ_DEPLOY_HOOK secret missing — cannot deploy. Add it to repo secrets." && exit 1`. Default: `curl -fsS -X GET "${SPACEZ_DEPLOY_HOOK}" && echo "Deploy hook triggered OK."`.
   - Add new job `post-deploy-smoke: needs: [trigger-deploy]`. Steps: checkout node24; `for i in 1 2 3; do STATUS=$(curl -fsS -o /tmp/body.json -w "%{http_code}" "${{ env.MAIN_APP }}/api/healthz" || echo 000); [ "$STATUS" = "200" ] && OK=1 && break; echo "Retry $i got status=$STATUS"; sleep 15; done; [ "$OK" != "1" ] && echo "::error::Post-deploy smoke failed — /api/healthz never healthy. REDEPLOY MANUALLY on Space-Z dashboard." && exit 1; cat /tmp/body.json`.
   - If smoke fails → workflow exit 1.
2. **Healthz route** (AC-8): `GET /api/healthz` → HTTP 200, JSON `{ ok: true, status: 'healthy', version: (read from package.json), timestamp: Date.now(), uptime: process.uptime(), commit: process.env.SOURCE_COMMIT || (try git rev HEAD), node_version: process.version, db_connected: (try prisma raw select 1 timeout 2s → ok:true/false without throwing), prisma_client: 'generated' }`.
3. **deploy/status record endpoint** (AC-9): add `PUT /api/deploy/status/record` handler:
   - Body `{instance, commit, status, health_ok, latency_ms, fc_error_type?, error_message?}`.
   - Append-only per-instance latest; stored in simple JSON cache file `data/deploy-status-cache.json` (path checked in deploy/status GET already via `safeCount`). Reflects on GET as a `latest_per_instance` field.
4. **Package engines**: verify `"engines": {"node": ">=24"}` in package.json; add if missing.
5. **.env excluded**: verify `.env` in `.gitignore` + in `package.json files:"!":.env`.

### Test Requirements
- **TR-3.1 (rule)**: `GET /api/healthz` returns 200 + JSON valid; ok=true + version match package.json.version; node_version starts with v24.
- **TR-3.2 (rule)**: `PUT /api/deploy/status/record` → 201; GET returns the written record as latest_per_instance.
- **TR-3.3 (rule)**: deploy-space-z.yml setup-node.version == "24"; trigger-deploy contains curl not echo; post-deploy-smoke exists with needs: trigger-deploy; missing SPACEZ_DEPLOY_HOOK → job fails (via -z check).
- **TR-3.4 (rubric ≥4/5)**: DAG completeness = 4 if 4 steps+good messages; 5 if 6-target /api/healthz build-verify pre-deploy smoke also added (probes all 6 TARGETS, fails if any not-healthy except known-previews).
- **TR-3.5 (rubric ≥4/5)**: Secret hygiene = 4 if no literals for 4 secret names; 5 if .gitignore/package files exclude .env explicitly.

---

## Task 4: Vitest full coverage for Procurement AC-1~6 + Z AC-7~9
- **Status**: pending
- **Priority**: high
- **Depends on**: Tasks 1, 2, 3
- **Parent AC**: AC-1 through AC-13 pass
- **Scope**: new test files: `src/lib/strict-enforcement/__tests__/strict-procurement.test.ts`, `src/app/api/healthz/__tests__/healthz.test.ts`

### Changes
1. **strict-procurement.test.ts** (TR-2.1~2.5; TR-1.1, 1.2):
   - T1: DisbursementPolicy sum 100 → PASS/THROW variants
   - T2: checkProcurementBudget PASS/BUDGET_EXCEEDED
   - T3: createOrGetPurchaseOrder x2 → same idem PO, row count 1 not 2
   - T4: confirmReceipt x2 same idem → no 2nd audit write
   - T5: supplier gate MA + fallback operator_approved
   - T6: payoutReleaseGate INCOMPLETE_THREE_WAY_MATCH when runThreeWayMatch report != PASS
2. **healthz.test.ts** (TR-3.1, 3.2):
   - T1: GET /api/healthz mock prisma → ok:true, version matches package.json
   - T2: PUT /api/deploy/status/record → GET latest reflects
3. Run `vitest run` for these 2 test files; pass.

### Test Requirements
- **TR-4.1 (rule)**: vitest for these files all pass.
- **TR-4.2 (rule)**: no new ts errors in touched files.

---

## Task 5: Independent Review
- **Status**: pending
- **Priority**: high
- **Depends on**: Tasks 1-4 complete
- **Scope**: `.trae/specs/secure-procurements-and-zspace-deploy/review.md` (fresh write)

### Write:
1. 13 ACs: rule PASS/FAIL for AC-1..9; rubric scores (1-5, threshold ≥4, justify+evidence) AC-10..13
2. Every AC with completion evidence link `path:line`
3. Overall verdict + any actionable findings
4. If any fail → back to Tasks 1-4 remediation items first; else → exit pass.
