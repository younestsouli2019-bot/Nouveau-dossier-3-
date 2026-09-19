# Secure Procurements + Space-Z Deploy Safety — Specification

## Problem Statement

Two independent surfaces are required to reach a "nothing gets lost, nothing deploys half-baked" steady state:

### P-Surface (Procurement)
Current repository contains a capable procurement library and 11 `src/lib/procurement/*.ts` modules, but has 6 hard gaps that would let money, inventory, or inventory-credits vanish:
1. No idempotency / double-PO-guard when a supplier acknowledgment webhook or the `submit-owner-procurement-request.mjs` runs twice — the same PO can be created twice.
2. No procurement-budget gate before `PO.approved`: PO can be approved with totalAmount exceeding the procurement_buffer FundBucket balance (FundBucket L853–L863 schema is authoritative).
3. Supplier resolution does NOT require `Supplier.isActive=true + verifiedAt` (Supplier schema lacks verifiedAt — currently only isActive). Moroccan-preferred supplier mandate (per user profile) is enforced as a soft preference but no hard gate on `country=='MA'` for any default route.
4. Payout release via payment-gateway-router's `payoutReleaseGate` requires 3-point tracking fraud pass, but does NOT force a successful `runThreeWayMatch(PO, shipment, receipt)` before `VERIFIED_OK → payout_release_allowed`. Three-way match exists but is optional today.
5. No idempotency fingerprint on `confirmReceipt` in `strict-procurement.ts` — the same physical delivery can be receipt-confirmed twice, inflating quantityReceived.
6. Owner profile mandates fixed revenue split 10% Salary / 40% Debt / 30% Sovereign / 20% Runtime = 100 exactly. Current DEFAULT_PCT in `buckets.ts:23–28` = sovereign(30) + procurement(10) + salary(40) = 80% → no runtime/debt entries AND sum ≠ 100. Bucket split mismatch silently pushes drift to salary (per line 76), compounding the profile-policy mismatch for procurement spend authorization.

### Z-Surface (Space-Z Deploy)
`deploy-space-z.yml` exists with jobs verify-secrets / build-verify / trigger-deploy, but 4 critical missing pieces:
1. Trigger-deploy is 100% echo + manual instructions (L87–L102). No actual deploy webhook runs. Deploy is unreachable from CI.
2. No `/api/healthz` HTTP route in `src/app/api` — deploy/status route L22/L23/L24/L25 probes `/api/healthz` on all 6 targets, but it does not exist locally (confirmed via Glob: 0 matches). Any freshly deployed build will look DOWN to the dashboard.
3. Workflow pins Node 22 (L62) but project runtime (settlement-engine, Prisma, autonomous-scheduler) pins Node 24. Node mismatch means build-verify runs on V22, then Space-Z Function Compute may run a different Node — a silent class of deploy bugs.
4. No post-deploy smoke/health probe in CI, no automatic rollback, no deploy-status page write-back. If the 3 Alibaba FC instances fail after deploy, nobody is told; GitHub green but runtime red.

## Users (Actors)
- Owner (Younes Tsouli, Attijari RIB 372, Moroccan sourcing mandate)
- Autonomous workers (procurement-daemon, swarm-tick, autonomous-scheduler provider-recon)
- Suppliers (Moroccan preferred; via local-suppliers-2026-09-01.csv)
- System operators (treasury/release manual ops-auth gated)
- CI/CD runners (GitHub Actions, Space-Z Alibaba FC)

## Goals
### Procurement goals
- G1: Every PurchaseOrder write and receipt confirmation is idempotent — repeated identical calls produce exactly one PO row, exactly one receipt write
- G2: PO.approved requires remaining FundBucket.procurement_buffer >= PO.totalAmount (fail-closed)
- G3: Preferred-Moroccan supplier routing with hard-catalog `country==MA` is default; fallback to international must be operator-explicit and approval-tracked
- G4: Three-way-match (PO ↔ Shipment ↔ Receipt) is mandatory (not advisory) before any `payoutReleaseGate` passes
- G5: Procurement spend is derived from a DisbursementPolicy whose bucketPct sums EXACTLY 100 (policy: Sovereign 30 / Runtime 20 / Salary 10 / Debt 40 per user profile — procurement funded from Runtime buffer, never direct from sovereign_reserves)
- G6: Receipt and PO approval both write append-only POApproval / AuditLedger rows with hash chains (TRUTH-PROC rules)

### Space-Z deploy goals
- GZ1: `deploy-space-z.yml trigger-deploy` actually triggers a real deploy via Space-Z hook (fail-closed if hook secret missing)
- GZ2: `/api/healthz` HTTP 200 JSON route exists locally AND is successfully probed by build-verify smoke-step, by post-deploy CI, and by deploy/status probes
- GZ3: CI pins Node 24 (same as project-wide), DATABASE_URL / BASE44_* secrets are verified present, build runs with NEXT_TELEMETRY_DISABLED=1, Prisma client generation runs BEFORE next build
- GZ4: Post-deploy smoke step calls the live Space-Z /api/healthz; if DOWN, CI fails explicitly with redeploy instructions, and the result is written into deploy/status page result cache

## Non-Goals (explicitly out of scope)
- NG1: No changes to Prisma schema.prisma (Supplier.verifiedAt, etc.) — enforce via code-level gates & default filter `isActive==true AND country!=NULL AND totalDelivered>0` as verification proxy
- NG2: No real money moves in this implementation; payoutReleaseGate is fail-closed (no webhook handler captures payment)
- NG3: No rewrite of autonomous-scheduler.yml payout reconciliation (settlement spec is complete, separate concern)
- NG4: No supplier onboarding UI rewrite; existing supplier-portal page is untouched
- NG5: No history-rewrite / mirror cleanup (completed per settlement review.md)

## Constraints (HARD)
1. **Never touch schema.prisma** — existing Supplier/PO/FundBucket/Payout/PayoutEvent/PayoutHold shapes are canonical.
2. **Fixed bucket split exactly 100%**: Debt(40) + Sovereign(30) + Runtime(20) + Salary(10) = 100.0. Non-sum-100 policy → fail-closed rejection, never silent-drift-to-salary.
3. **Moroccan supplier default**: Any PO routed via default optimization `runOptimization()` → supplier `country==MA` is mandatory if one exists with the item category. International fallback requires `operator_explicit_approval: true` in PO.metadata with a POApproval row.
4. **payoutReleaseGate requires threeWayMatch.report.status == PASS** — no 3-way = no money release, even if 3-point fraud guard is VERIFIED_OK.
5. **Idempotency keys**: every PO write and every receipt confirmation MUST carry an idempotency fingerprint; without it the request is rejected with HTTP 400 / Promise {success: false}.
6. **Space-Z must deploy with verifiable Node 24 build**, same as project-wide Node pinned in package.json/tsconfig.
7. **Healthz is canonical**: no deploy is considered successful until `/api/healthz` returns HTTP 200 with `{ok:true,status:"healthy"}` AND contains `version: semver` (package.json version).

## Dependencies / Assumptions
- DEP-1: `secrets.SPACEZ_DEPLOY_HOOK` may or may not exist. CI gate on its presence with a descriptive failure message, never silently skips.
- DEP-2: `secrets.DATABASE_URL`, `BASE44_API_KEY`, `BASE44_SERVICE_TOKEN` are required.
- DEP-3: 3-point tracking fraud VERIFIED_OK is a prerequisite to 3-way-match; 3-way-match is prerequisite to payout.
- DEP-4: Runtime-operations bucket = 20%. Procurement_buffer is funded OUT OF the 20% runtime bucket as a sub-budget (not a top-level %). Top-level % = 4 buckets sum 100.
- DEP-5: User profile: Salary 10% / Debt 40% (Attijari RIB 372) / Sovereign reserves 30% / Runtime 20%. Procurement spend sub-authorized from Runtime 20% bucket (never dips into Sovereign/Debt/Salary directly).

## Open Questions (resolved below with design-informed defaults; explicit in tasks.md)
1. **Q: What is the source of truth for the 40% Debt bucket's funding destination?** → A: Per user profile, Attijariwafa RIB 372. Not implemented here beyond DisbursementPolicy bucketPct values; settlement engine handles actual payout execution per its spec.
2. **Q: Can international suppliers ever be used?** → A: Yes, only with `operator_explicit_approval: true` + POApproval row, and only when zero Moroccan suppliers exist for the given category.
3. **Q: Where does procurement_budget come from if procurement_buffer is dropped from top-level DEFAULT_PCT?** → A: Procurement spend sub-authorization = 10 out of 20 runtime_operations bucket (50% of runtime, 10% of total NET). This matches prior effective procurement=10% level without breaking the 4-bucket 100% sum constraint.
4. **Q: Does Space-Z deploy hook format need a specific payload?** → A: Default to GET deploy hook URL with `deploy_token` query param; allow override via `SPACEZ_DEPLOY_HOOK_FORMAT` var (form-post/json). Fail-closed if no deploy hook resolves.

## Requirements (functional F- + non-functional NF-)
### Procurement Functional
- F-P1: `submitPurchaseOrder(input, idempotencyKey)` → creates PO + write POApproval rows, double-submit returns same existing PO id without side effects. Idempotency key = sha256(poNumber | supplierId | totalAmount | currency | ownerInitiated).
- F-P2: `approvePurchaseOrder(id, approver)` first checks `FundBucket.procurement_buffer_spendable >= PO.totalAmount` (spendable = allocated - released), fail-closed with BUDGET_EXCEEDED error if insufficient.
- F-P3: `getPreferredSupplierForCategory(category, allowInternationalFallback?)` → if `allowInternationalFallback != 'operator_approved'`, restrict results to `country == 'MA' AND isActive == true AND totalDelivered > 0`. Fail-closed 404 if none.
- F-P4: `payoutReleaseGate(procurementItemId, gatewayContext)` returns `release_allowed: true` ONLY IF (i) `verifyTrackingPayload() == VERIFIED_OK` AND (ii) `runThreeWayMatch(po, shipment, item)` report status == PASS AND (iii) `receiptConfirmedAt != null AND deliveryProofHash.length >= 64`.
- F-P5: `confirmReceipt(params)` (strict-procurement) requires `idempotencyKey` argument; idempotent-write pattern (findFirst by idempotencyKey metadata on AuditLedger → return prior result, else write).
- F-P6: `getDisbursementPolicy()` returns `bucketPct: { sovereign_reserves:30, runtime_operations:20, salary_bucket:10, debt_repayment:40 }`; sum check throws `BUCKET_SUM_MISMATCH` if not exactly 100 (never silent-drift). Legacy `procurement_buffer` remains as a sub-allocation accounting label but is removed from top-level DEFAULT_PCT to preserve 4-bucket 100%.

### Space-Z Deploy Functional
- F-Z1: `deploy-space-z.yml trigger-deploy` job actually calls the deploy hook via curl (HTTP GET or POST). Fails if `secrets.SPACEZ_DEPLOY_HOOK` not set or response != success.
- F-Z2: `src/app/api/healthz/route.ts` GET returns JSON `{ ok: true, status: "healthy", version: package.json.version, timestamp, uptime: process.uptime(), commit: git-describe if available, node_version: process.version }`.
- F-Z3: Node 24 pinned everywhere in deploy-space-z.yml (setup-node L62 →24).
- F-Z4: Post-deploy smoke job (new) calls the just-deployed target `/api/healthz`, retries 3 times with 15s backoff, fails workflow explicitly on non-200/non-healthy, writes a deploy-status record via POST to `/api/deploy/status/record` endpoint.
- F-Z5: deploy/status route includes new `/api/deploy/status/record` PUT endpoint that accepts `{instance, commit, status, health_ok, latency_ms, error_type?}` and persists latest per instance (in-memory + file cache), displayed by GET.

### Non-Functional
- **NF-1 Fail-closed everywhere**: missing secret/missing supplier/insufficient budget always throws a user-actionable error, never returns an "allowed" boolean true.
- **NF-2 Idempotency deterministic**: fingerprint = stable canonical order, case-insensitive values normalized to uppercase for currencies, phone/email trimmed.
- **NF-3 Audit append-only**: every PO approve/reject, receipt confirm, and supplier fallback override writes at least one AuditLedger / POApproval row with sha256 hash chain (previousHash).
- **NF-4 Zero secrets in code literals**: SPACEZ_DEPLOY_HOOK, DATABASE_URL, etc. only ever read from `process.env`. Grep `SPACEZ_DEPLOY_HOOK` literal in src returns 0 matches.
- **NF-5 Node consistency**: package.json "engines" field ≥ 24 if absent; deploy workflow mirrors project-wide.

## Acceptance Criteria (13 ACs)
All AC = rule (binary PASS / FAIL) unless explicitly marked rubric.

| #  | Type   | AC text (pass condition) |
|----|--------|--------------------------|
| AC-1 | rule | `submitPurchaseOrder()` with same idempotencyKey twice → 2nd call returns same PO.id, POApproval row count does NOT increase (1 row not 2). |
| AC-2 | rule | `approvePurchaseOrder(PO.total > FundBucket.spendable)` returns `{approved:false, code:'BUDGET_EXCEEDED'}` and PO.status stays 'pending_approval'. |
| AC-3 | rule | `getPreferredSupplierForCategory('electronics')` with MA catalog = MA-only returns; zero MA returns 404 when allowInternationalFallback != 'operator_approved'. |
| AC-4 | rule | `payoutReleaseGate()` → 3-point fraud VERIFIED_OK but NO threeWayMatch PASS → release_allowed: false, reason code INCOMPLETE_THREE_WAY_MATCH. |
| AC-5 | rule | `confirmReceipt(params)` called twice with same idempotencyKey → 2nd call returns identical prior receipt result, no extra AuditLedger rows. |
| AC-6 | rule | `getDisbursementPolicy().bucketPct` sum exactly 100; bucketPct values = sovereign(30), runtime(20), salary(10), debt(40); call with any mutated values throws BUCKET_SUM_MISMATCH. |
| AC-7 | rule | `deploy-space-z.yml`: (a) setup-node version == 24; (b) trigger-deploy actually calls curl not echo; (c) post-deploy smoke probes /api/healthz x3 retries; (d) missing SPACEZ_DEPLOY_HOOK fails job explicitly. |
| AC-8 | rule | `GET /api/healthz` returns HTTP 200, JSON.body `ok=true AND status='healthy' AND version matches package.json AND node_version starts with 'v24.`. |
| AC-9 | rule | `deploy/status route` now accepts `PUT /api/deploy/status/record` body `{instance, commit, status, health_ok, latency_ms}` and GET reflects the latest recorded per-instance value. |
| AC-10 | rubric | Procurement fail-closed coverage (0-5): score=5 iff all 5 fail-closed gates (budget, supplier, 3-way, 2x idempotency) exercised in unit tests with both sides pass/fail, each with evidence. |
| AC-11 | rubric | Space-Z deploy pipeline completeness (0-5): score=5 iff workflow contains (verify-secrets → build-verify → trigger-deploy → post-deploy-smoke) linear chain with proper `needs:` DAG, AND each step produces unique passing/failing outputs with descriptive error messages, AND healthz on all 6 targets probed in build-verify smoke. |
| AC-12 | rubric | Audit append-only fidelity (0-5): score=5 iff every PO approve/reject, receipt confirm, and supplier fallback override writes at least 1 hash-chained AuditLedger or POApproval row with previousHash + entryHash sha256 format, plus Vitest tests showing double-submit never duplicates chain entries. |
| AC-13 | rubric | Secret hygiene (0-5): score=5 iff grep `SPACEZ_DEPLOY_HOOK|DATABASE_URL|BASE44_*` in src/**/*.ts,scripts/**/*.mjs returns 0 literal matches (ONLY process.env reads), AND deploy-space-z.yml secrets come from `${{ secrets.* }}` not inline values, AND package.json `files` excludes .env. |
