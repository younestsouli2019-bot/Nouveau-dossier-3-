# SPEC MODE #8 — Swarm Revenues Auto-Route Owner Hands-Free v3.5.8

**Date:** 2026-10-05 · **Branch:** release · **Base commit:** 7b4e0be (SPEC7 followup)  
**Signataire:** Younes Tsouli CIN A337773 (Contentieux 018 Rabat Agdal)

---

## 1. Problem, Users, Goals, Non-Goals

### Problem
Swarm activities (clickless-tick / autonomy-daemon / swarm-consensus / inbound-scout / CCXT balance deltas / EVM wallet receipts / Neon RevenueEvent completed rows) generate verifiable revenues. Currently:
- 3 independent scripts (`auto-run-v354-owner-payouts.ts`, `owner-payout-evm.mjs`, `owner-payout-paypal.mjs`) handle payouts WITHOUT cross-coordination;
- ALL require manual signature flags (`--confirm` on EVM, S0 prompts, staged approval gates);
- No automated routing to the 6 preset owner accounts on bucket ordering;
- Rail deadlock = silent NOOP when Banking Circle SDK / PayPal PPP2 / Attijari PSD2 creds missing.

### Users
- **Primary (Signataire):** Younes Tsouli CIN A337773 — Financial Supervisor, expects revenues to arrive in presets 10/40/30/20 split ZERO manual, ZERO signature.
- **Secondary (Huissier contentieux 018):** Audits bucket splits against Décret 2015-1510 + signataire dissociation HY-1/2/3 — needs HMAC-chain ledger evidence.

### Goals
1. Every swarm-detected revenue → auto 10/40/30/20 bucket split (NG5 Zero-Loss Δ≤$0.01).
2. Each bucket → route to its preset account in **BUCKET ORDER**: SALARY 10% → RIB182 FIRST, then DEBT 40%→RIB372, then SOUVERAIN 30%→BC646, then OPS 20%→BC646 (user choice Q2=Option B).
3. **Full signature bypass** when OWNER_HANDS_FREE_POLICY=true AND G1-G4 gates PASS — remove ALL `--confirm` requirements, ALL S0 prompts, ALL batch confirmation waits (Q1=Option A).
4. Hard fail-closed per bucket-per-rail: if its assigned rail dead → QUARANTINE that bucket's portion, LOG honest ≥40 chars reason, NEVER cross-route to different bucket preset (Q3=Option A).
5. Event source = ALL sources (Q4=Option A): Neon `RevenueEvent status=completed proofHash len≥10` + `inbound-scout` wires + `settlement-worklist` EVM/Binance increases + CCXT balance deltas.

### Non-Goals (fail-closed on these)
- ❌ Never change BUCKET_PCT from [10,40,30,20]. (Permanent v3.5.7 canonical).
- ❌ Never fabricate `proofHash` / `POD:<carrier>-sha256:<h>` for POs (NG2 0-fabrication).
- ❌ Never cross-bucket rebalance — salary portion never sent to debt preset and vice versa (contentieux legal separation).
- ❌ Never write DATABASE_URL into Machine/User persistent env (NG6 NFR-5 Process only).
- ❌ Never push from inside IDE sandbox (existing NG6 preserved — 6-step HORS runbook still required).

---

## 2. Functional Requirements (FR)

### FR-1 — Revenue Source Aggregator (ALL sources Q4-A)
Create pure aggregator `collectSwarmRevenues()`:
1. DB source (G2 open only): Neon `SELECT id, amount, currency, proofHash FROM RevenueEvent WHERE status='completed' AND LENGTH(proofHash)>=10 AND id NOT IN (SELECT reId FROM RevenueLedgerEntry WHERE rail='swarm-auto-route-v358')`
2. FS source: parse last `logs/swarm_clickless/latest.json` Phase 2 `inbound-scout` detected wires (amount>0).
3. FS source: parse last `data/out/settlement-worklist.json` EVM+Binance increases (diff vs previous persisted `data/out/swarm-revenues-prev-state.json`).
4. Network source (read-only): CCXT `binance.fetchBalance()` USDT delta vs persisted prev value (if G3 Binance creds set).

> Idempotence key per event: `swarm-auto-route-v358:<source>:<sourceId>`

### FR-2 — BUCKET_PCT Canonical Split (NO CHANGE 10/40/30/20)
Pure `computeBucketSplit(netAmount)`:
- SALARY (10%) = 0.10 × net → dest=ATTIJARI_RIB182_SALAIRE
- DEBT   (40%) = 0.40 × net → dest=ATTIJARI_RIB372_DETTE
- SOUV   (30%) = 0.30 × net → dest=BANKINGCIRCLE_LU24_RIB646_SOUVERAIN
- OPS    (20%) = 0.20 × net → dest=BANKINGCIRCLE_LU24_RIB646_OPS

Enforcement rule (binary): `SAL+DEBT+SOUV+OPS = net ±0.01`. Penny residuals → SALARY absorbs.

### FR-3 — Bucket Order Dispatch (Q2 Option B Bucket Order Priority)
Sequential send queue, never parallel across buckets (legal contentieux separation MUST BE audit-ordered):
```
  Step 1: send SALARY  → RIB182 (1st — signataire paid first legal precedence)
  Step 2: send DEBT    → RIB372 (2nd — recovery créances contentieux)
  Step 3: send SOUV    → BC646 (3rd — réserves souveraines)
  Step 4: send OPS     → BC646 (4th — exécution runtime)
```

### FR-4 — Signature Bypass (Q1 Option A Full Bypass)
When `BOTH` are true simultaneously, ALL signature gates dissolve (treat as legal e-sig):
1. `process.env.OWNER_HANDS_FREE_POLICY === 'true'`
2. G1≥8, G2 len(DATABASE_URL)≥120, G3 Binance KEY+SECRET both len≥32, G4 len(OWNER_EXEC_UNLOCK)≥43 (G1-G4 all PASS).

Impacted code locations to auto-bypass (no code change needed in harness outside wrapper auto sets the "signed" flag):
- `scripts/owner-payout-evm.mjs`: auto-inject `--confirm` flag internally → dry-run plan written BUT send executes.
- `scripts/owner-payout-paypal.mjs`: auto-skip confirmation prompts → execute send immediately.
- `scripts/auto-run-v354-owner-payouts.ts`: S0 confirmation auto-accepted → move to S1 worklist build.

### FR-5 — Per-Bucket Hard Fail-Closed Rail Deadlock (Q3 Option A)
For each bucket rail independently:
- Rail-status check BEFORE send: call the rail's own `canSend()` checker from `payment-routing-table.mjs`.
- If `canSend===false` OR creds missing → **QUARANTINE bucket amount** → write:
  - `OwnerSettlement.status = 'QUARANTINE'`
  - `AuditLedger.op = 'SWARM_ROUTE_QUARANTINE'` with `reason = <≥40 chars exact explanation: e.g., "BankingCircle SDK creds missing user/pass/endpoint BIC lookup G2 fail rail dead per payment-routing-table line 197">`
  - file `data/out/swarm-route-quarantine.ndjson` append line: `ts|bucket|amount|rail|reason|hmac`
- NEVER divert amount to different bucket preset destination even if that rail IS alive (cross-bucket = accounting fraud contentieux séparation).

### FR-6 — Integration with START-OWNER-HANDS-FREE.cmd Lifecycle
After autorotate-pre-wrapper (t7) runs → insert new phase **PHASE 0.5 SWARM ROUTE**:
```
PHASE 0:  autorotate pre-wrapper → DPAPI → 5-target sync → exit 0 OK
PHASE 0.5: SWARM REVENUE ROUTE  → collect → split → bucket-send → HMAC audit chain append
PHASE 1:  run-live-crypto-po.ps1 G1-G4 check → exit 2 BLOCKED or exit 99 LIVE_EXEC
```

### FR-7 — HMAC-Chain Audit (per NG7)
Every event split + 4 bucket sends writes append-only NDJSON line `data/out/swarm-revenues-route-v358.ndjson`:
```
format: <ts ISO>|route_v358|<eventId>|bucket=<CODE>|amount=<n>|dest=<presetID>|rail=<rail>|status=<SENT|QUARANTINE>|txid_or_reason=<…>|HMAC-SHA256=<64hex>
```
Chain rule: HMAC[i] = HMAC(HMAC[i-1] + line content), HMAC[0] = sha256("SWARM-ROUTE-v358" + SPEC commit).

---

## 3. Non-Functional Requirements (NFR)

| NFR | Requirement |
|-----|-------------|
| NFR-1 | Pure 0-dependency node core only runner (standalone script `.mjs` — no new npm install, no tsx require). |
| NFR-2 | All DB writes are IDEMPOTENT with ON CONFLICT DO NOTHING key `swarm-auto-route-v358:<eventId>:<bucket>`. |
| NFR-3 | Process env only — NEVER SetEnvironmentVariable Machine/User. Verify with grep (count=0 for forbidden scopes). |
| NFR-4 | SANS-DB read-only mode when G2=FAIL: still runs collection + computes split + outputs STDOUT plan table (0 DB write). |
| NFR-5 | Runtime ≤120s with 8 secrets present (no hanging network waits; 15s fetch timeout per source). |
| NFR-6 | Zeroize: after signing HMAC with OWNER_EXEC_UNLOCK as key, buffer memory filled with 0x00 THEN compare shadow (9 buffers like SPEC7 AC11). |
| NFR-7 | 193/193 vitest regression PASS after changes. NO new test failures. |
| NFR-8 | No `.keys/**` leak to git → verified `git ls-files .keys/` count=0. |

---

## 4. Constraints, Dependencies, Assumptions

### Hard Constraints (Fail on Violation)
1. **BUCKET_PCT PERMANENT:** salary=10, debt=40, sovereign=30, runtime=20. Sum must equal 100 exactly.
2. **Cross-bucket send = FAIL-CLOSED exit 7, forensic marker:** SALARY amount → NEVER RIB372, NEVER BC646. DEBT amount → NEVER RIB182.
3. **G1-G4 all PASS = PREREQUISITE for live send.** If ANY gate FAIL → SANS-DB plan only written, 0 outbound, exit code=0 OK (plan produced).
4. **DPAPI seed/UNLOCK leak forbidden:** never write `OWNER_EXEC_UNLOCK` to FS — only Process env.
5. **6 Preset Account Destinations = FIXED LIST.** No new accounts without signataire written new SPEC:
   - RIB182 = salary (10%)
   - RIB372 = debt (40%)
   - BC646 sov = sovereign (30%)
   - BC646 ops = runtime (20%)
   - (Payoneer/PayPal/USDC L2 = can be alternate destinations ONLY for same bucket AND EXPLICIT user new SPEC.)

### Dependencies
- Uses EXISTING: `owner-payout-evm.mjs` (BC646/USDC via EVM rail), `payment-routing-table.mjs` canSend status, `settlement-worklist` probes, `BUCKET_DEFAULT_PCT` from [buckets.ts](file:///C:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/lib/treasury/buckets.ts).
- Standalone runner uses node core only (fs/crypto/path/child_process).

### Assumptions
1. Signataire will perform R1/R2 SPEC7 bootstrap before LIVE routing runs (placeholder HKDF values honest SKIP).
2. R5 HORS Trae push runbook pushes this new SPEC8 runner script + wrapper phase.
3. Gitleaks installation (R3 SPEC7) runs separately — no requirement here.

---

## 5. Open Questions Resolved (from AskUserQuestion)
1. **Signature bypass** → Option A (full bypass, HANDS_FREE=true + G1-G4 PASS = legal e-sig)
2. **Routing priority** → Option B (BUCKET ORDER: salary → debt → sov → ops)
3. **Rail dead behavior** → Option A (hard fail-closed quarantine per-bucket, no cross-rail diversion)
4. **Event source scope** → Option A (ALL sources: DB + FS + network + EVM/CCXT delta)

---

## 6. Acceptance Criteria (rule / rubric ONLY)

| AC # | Type | Rule or Rubric Pass Condition | Max Pts |
|------|------|--------------------------------|---------|
| AC-1 | **rule** | Binary: Standalone runner `scripts/swarm-revenues-auto-route-v358.mjs` exists. `node --check` syntax exit 0. 0 external imports (only node:fs/crypto/path/child_process allowed). | 2 |
| AC-2 | **rule** | Binary: BUCKET_SPLIT math test. Inject 10 independent USD amounts (e.g., $127.30, $5000, $6728.77, $0.99, $100, $8.08). For each: SAL=0.10×, DEBT=0.40×, SOUV=0.30×, OPS=0.20×. Σ4 = input ±0.01. Penny residuals added to SAL. (10/10 correct → PASS). | 2 |
| AC-3 | **rule** | Binary: Bucket order dispatch. On mock 4-rail-live dataset, assert send invocation ORDER array = `["RIB182","RIB372","BC646_SOV","BC646_OPS"]`. No permutation allowed. | 2 |
| AC-4 | **rule** | Binary: Signature bypass. When HANDS_FREE=true AND G1-G4 4/4, capture STDIO to `owner-payout-evm.mjs` — argument array MUST include `--confirm` injected automatically, and wrapper must NOT prompt for input (timeout 30s no stdin). | 2 |
| AC-5 | **rubric** | Hard fail-closed quarantine. Quality scale 0-2. 2 pts = 40+ char reason logged in `swarm-route-quarantine.ndjson` when Banking Circle SDK user=placeholder, AND `OwnerSettlement.status=QUARANTINE` (if DB open), AND 0 amount cross-sent to salary preset to cover sov portion (cross-bucket count=0). 1 pt = quarantine logged but reason <35 chars OR DB write missing. 0 pts = cross-bucket diversion observed (FAIL). | 2 |
| AC-6 | **rule** | Binary: Idempotence. Run the SAME dataset 3× consecutive on same dataset. Output file `swarm-revenues-route-v358.ndjson` line count = line count(first run) ONLY. No duplicate lines. No duplicate OwnerSettlement created (DB: SELECT COUNT WHERE externalRef LIKE 'swarm-auto-route-v358%' same on run1/run3). | 2 |
| AC-7 | **rule** | Binary: SANS-DB plan mode. With DATABASE_URL unset (G2 FAIL), script exits 0, writes `data/out/swarm-revenues-plan.json` with split table, sends 0 network calls, 0 DB writes. Verify with grep "FETCH|UPDATE|INSERT" output count=0 on stderr/stdout. | 2 |
| AC-8 | **rule** | Binary: HMAC chain integrity. Sample indices 2,5,last. Chain recalculation MATCHES stored HMAC. Total lines ≥10 on first populated run. | 2 |
| AC-9 | **rubric** | Wrapper integration fidelity. Scale 0-2. 2 pts = `scripts/autorotate-pre-wrapper.ps1` successor phase runs swarm-auto-route AFTER t7 autorotate exit 0 AND BEFORE invoking `run-live-crypto-po.ps1` AND passes exit code correctly (exit code of phase 0.5 propagates; only exit 3 LOCK BUSY tolerated, exit ≥7 = fail-closed wrapper abort 5). 1 pt = phase called but exit code not propagated. 0 pts = phase not in lifecycle. | 2 |
| AC-10 | **rule** | Binary: 0 cross-bucket send fraud check. Inject 2 events ($500 + $1500), force salary rail dead (RIB182 = offline), quarantine salary portions as expected. Then post-audit: all non-quarantine lines bucket matches preset: "RIB182→salary_only OR quarantine". No amount of bucket=debt ever credited to RIB182 in plan/ledger. (grep + assert → PASS). | 2 |
| AC-11 | **rubric** | Zero-loss (NG5) aggregate. Scale 0-2. 2 pts = Total Sent + Total Quarantined = Σ Collected Event Amounts ±0.01 USD. Missing sum Δ>0.01 = FAIL 0 pts. Quarantine recorded count matches expected rail dead bucket count. 1 pt = Δ=0 but quarantine amounts mismatched (rail alive wrongly marked). | 2 |
| AC-12 | **rule** | Binary: Process-only env. After full run, powershell: [Environment]::GetEnvironmentVariable('DATABASE_URL','User') = $null AND 'Machine' scope = $null. All 8 UNBLOCK8 absent from both persistent scopes. | 2 |
| AC-13 | **rubric** | Regressions + runtime. Scale 0-2. 2 pts = `vitest run` 193/193 pass, `node --check` on ALL scripts 0 errors, `.keys/` leak count=0. 1 pt = vitest ≥190 but <193, or one --check fail trivial. 0 pts = <190 vitest = FAIL. | 2 |
| | | **Total Threshold PASS → ≥ 21/26** | **26 pts** |

---

## 7. Permanent Pins (Verbatim Carryover)
- Node 24.21.0, Prisma 7.10.0, Next 16.3.4, Vitest 3.2.6
- 9 NG doctrines (NG1-NG9) carryover SPEC7 unchanged.
- Contentieux 018 dissociation HY-1/2/3 still active.
- SPEC7 custom local KMS still required for LIVE values (no external vault reintroduction ever).
