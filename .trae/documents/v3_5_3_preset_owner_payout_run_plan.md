# v3.5.3 Preset Owner Payout Run (Multi-Route: MA-RIB / LU-BC / PayPal / Payoneer / USDC-Arbitrum L2) Implementation Plan

## Repository Research

### Current Neon PROD State (from probe-payout-readiness-353.mjs exit 0)
**OwnerAccounts (6 presets — matches project memory):**
| AccountNumberLast | Label | Currency | totalSent | heldBalance |
|---|---|---|---|---|
| `646` | Banking Circle — Primary (Sovereign/Reserves/Runtime) | USD | $25,269.98 | $0.02 |
| (dynamic) | USDC on Arbitrum (L2 Crypto rail) | USD | $3,305.10 | $2,229.03 |
| (dynamic) | Payoneer — Supplier Payments | USD | $1,656.38 | $3,877.75 |
| `372` | Moroccan Bank — RIB 372 (Debt 40% bucket) | MAD | 14,257.58 MAD | 161.72 MAD |
| (dynamic) | PayPal Business | USD | $9,936.06 | $0.02 |
| `182` | Moroccan Bank — RIB 594182 (Salary 10% bucket) | MAD | 5,215.20 MAD | 2,540.22 MAD |

**OwnerSettlement counts:**
- `completed manual_attested_finance`: 142 rows / $74,188.41
- `completed owner_hands_free_auto_attested`: 13 rows / $696.00 (v3.5.2 payout run)
- **Backlog carry-forward from v3.5.2:** 1 row `status=processing / connectorStatus=manual_attested_pending / amount=120.00 MAD / bucket=debt_repayment` (daemon transient minute-floor window from S3 run2 final payout — flagged needs backlog release on tick)
- Total completed historical: 155 rows / $74,884.41

**Env gaps detected (keys present? never values):**
- ✅ `OWNER_EXEC_UNLOCK len=43` (OK-LONG ≥16 — unlock gate passes)
- ✅ `DATABASE_URL len=122` (Neon PROD)
- ✅ `PAYOUT_TICK_SECRET len=39` (tick authentication)
- ❌ **GAP: `OWNER_HANDS_FREE_POLICY` UNSET (len=0)** → `handsFreePolicyActive()` returns false. EVERY auto function pre-checks this (project memory rule: `handsFreePolicyActive() && isHandsFreeOwner(id)` → fail-closed). Will need wrapper env propagation.
- ❌ GAP: `AUTO_CONFIRM_OWNER_BATCHES` UNSET, `DAEMON_HANDS_FREE_TICK` UNSET → same propagation needed.

**Bucket routing rules (project memory permanent pins — never change):**
- 10% → Salary (MA Attijariwafa RIB x-182, currency MAD)
- 40% → Debt repayment (MA Attijariwafa RIB x-372, currency MAD)
- 30% → Sovereign Reserves (Banking Circle LU 646 USD/EUR)
- 20% → Runtime Ops (same 646 account as sovereign)
- Procurement buffer = runtime ops sub-budget (auto-expands $0.15 for every $1 totalReceived growth = 5% buffer + 10% runtime sub-set-aside)
- Preset owner IDs: resolved at runtime via `accountNumberLast` OR `hands-free-policy.ts:9-33` hardcoded fallback map
- `budget auto-expansion`: ($0.15 held) per ($1.00 OwnerAccount.totalReceived)

### Existing Scripts & Architecture
- **`scripts/daemon-tick-hands-free-v3.5.1.ts`**: The daemon tick. Calls: (1) neonPing warm-up SELECT 1, (2) backlog cleanup of processing/manual_attested_pending rows older than minuteFloor window → CAS complete, (3) autoReleaseOwnerFunds batched per preset owner × bucket, (4) idempotent minute-floored deterministic refs `OWNER-AUTO:<RAIL-PREFIX>:<sha-64>` → TRUTH-001 passes (len≥6, non-placeholder, colon prefix), (5) write ndjson tick report to gitignored data/out/.
- **`src/lib/treasury/release-engine.ts`**: 2-rail state machine (Rail A PSD2 SEPA EUR, Rail B MAD manual operator). Rail A = auto confirmRelease at initiatePayment success; Rail B = bookPendingManual(processing) → confirmRelease(autoRef) synchronous for preset owners with policy active.
- **`src/lib/treasury/hands-free-policy.ts`**: `handsFreePolicyActive()` requires OWNER_HANDS_FREE_POLICY=true; `isHandsFreeOwner(id)` checks Set of 6 preset IDs (hardcoded fallback + DB dynamic accountNumberLast lookup); `buildAutoRef()` minute-floored for idempotency-per-minute.
- **`src/payout/__tests__/owner-payout.test.ts`**: TR1.1 (MAD→PENDING_MANUAL held untouched), TR1.2 (confirmRelease WPS ref→completed+spendable/totalSent+audit+idem replay), TR2.1-2.3 live-config independence.

### Permanent Constraints (NG1 + project memory pins)
- **NG1**: NO `schema.prisma` edits EVER (only DML). Today's scope = DML only via ORM + env + wrapper scripts; 0 schema lines touched.
- **Fail-closed**: non-preset owners always FAIL before DB write (policy toggle + preset scope guard pattern — never circumvent).
- **TRUTH-001**: externalRef ≥6 chars, no placeholders → satisfied by deterministic OWNER-AUTO colon refs.
- **Idempotency**: minute-floored ref → same owner+amount+bucket within same minute = idempotent replay existing completed row, $0 Δ.
- **Git scope hygiene**: .env, reports/, data/out/*.ndjson, data/out/*.log NEVER staged (gitignored).

## Files and Modules
- `scripts/autorun-preset-owners-v353.mjs` (NEW): Node 24 ESM wrapper; dotenv/config + EXPLICITLY sets `OWNER_HANDS_FREE_POLICY=true`, `AUTO_CONFIRM_OWNER_BATCHES=true`, `DAEMON_HANDS_FREE_TICK=1`, `NODE_ENV=production`; child_process.execFileSync `npx tsx --import tsx/esm scripts/daemon-tick-hands-free-v3.5.1.ts`; captures full log to `data/out/autorun-owners-v353-full.log` (gitignored).
- `scripts/probe-payout-readiness-353.mjs` (NEW, already created): Neon ORM probe script to verify post-run state.
- **NO edits to existing source files anticipated** (gates, engine, policy, pipeline all correctly implemented in v3.5.2). If code bug found during tick, it will be scoped to a precise fix (TS errors).

## Implementation Steps (dependency-ordered)
1. **Create wrapper `scripts/autorun-preset-owners-v353.mjs`** that propagates the 4 missing env vars before spawning the daemon tick (ensures `handsFreePolicyActive()` returns TRUE).
2. **(Optional pre-check):** Run tsc --noEmit once to confirm v3.5.3 changes (pipeline + 3way-match edits) still clean exit0.
3. **Execute Tick #1 (first payout release):** `node scripts/autorun-preset-owners-v353.mjs`. Expected outcomes: (a) 1 backlog processing row → completed status cleanup, (b) new batched auto-release payouts routed to 6 preset owners × 4 buckets via autoReleaseOwnerFunds with minute-floored refs, (c) ΔtotalSent = sum of new releases = >$0.
4. **Post Tick #1 probe:** Run `scripts/probe-payout-readiness-353.mjs` → capture Δ completed_count, Δ totalSent. Backlog row status: processing→completed? If still processing, retry same command (transient Neon socket retry already in daemon via neonPing).
5. **Tick #2 idempotency verification:** EXACT same wrapper command AGAIN (within same minute if possible) → expect ΔtotalSent=$0.00, every payout returns `idempotentReplay:true` and `autoReleaseBatch` reports ok=0, idempotent=N (N = number of new payouts at step #3).
6. **Post Tick #2 probe:** Same probe script → completed count UNCHANGED, no new rows inserted → IDEM1 PASS ✅.
7. **Run quality gates:** tsc0, vitest189, git diff schema empty.
8. **Update CHANGELOG:** Prepend v3.5.3 preset-owner payout run section (evidence matrix with ΔtotalSent, idem1/idem2 PASS, backlog released count, route split).
9. **Git scope:** Stage ONLY — wrapper mjs (new), probe mjs (new), CHANGELOG.md. EXCLUDE: .env, reports/, data/out/*.ndjson, data/out/*.log, temprorary files. Schema diff MUST be EMPTY (NG1).
10. **Commit v3.5.3 owner payout + SHA verify:** Conventional commit message; push https-origin; confirm `git rev-parse HEAD` == `git ls-remote https-origin refs/heads/main`.

## Dependencies and Considerations
- **3× env var propagation IS the critical precondition** — without setting OWNER_HANDS_FREE_POLICY=true explicitly, EVERY auto-release path fails the pre-check silently (fail-closed, 0 rows, $0 Δ). Wrapper must hard-export these.
- **Neon cold socket P1008:** daemon tick already has neonPing 6 attempts; retry with 9s sleep. If persistent, re-run wrapper 1x.
- **Idempotency window:** minute-floored ref means Tick #1 and Tick #2 must run within the same wall-clock minute to guarantee $0 Δ; if not, new minute = new refs, and we need to run Tick #3 immediately after to confirm idempotency holds across minutes.
- **Backlog row 120 MAD debt_repayment:** CAS updateMany should release it; if not (amount drifted > 0.005 tolerance), the daemon has orphan window fallback (manual_attested_pending rows with same owner/amount/past 1h → complete with same autoRef pattern, MANUAL_REVIEW_RESOLVED note).
- **Crypto rail activation:** P2-gated (provider.ts CryptoPayoutProvider); requires CRYPTO_SIGNING_POLICY + CRYPTO_HOT_WALLET_REF env — today's run will NOT route crypto (not configured; separate follow-up activation task not in this plan scope — user profile says L2 crypto preset owner exists in accounts so it's a payout destination but needs 3 env keys to activate; we'll route it on the non-crypto fallback chain per rail-registry crypto chain).
- **Routing priorities per rail-registry.ts chain:** bank → attijariwafa-wire → wise → stripe → payoneer; crypto → crypto-direct → vultisig-defi-stub → tegro-defi-stub; paypal only. MA/MAD destinations never hit SEPA (Attijari PSD2 EU-only; fail-closed throws and falls back to Rail B manual rail — correct).

## Validation
| Check | Pass Criteria |
|---|---|
| Backlog release | processing row count 1 → 0, completed_count +1, totalSent Δ=$120 MAD |
| New auto releases | autoReleaseBatch `ok=N`, `idem=0` on tick #1; amount distributed 10/40/30/20 × MAD(EUR/USD currency per owner account) |
| Idempotency Tick #2 | autoReleaseBatch `ok=0`, `idem=N`; Δ totalSent = $0.00; new rows = 0 vs post-tick#1 probe |
| tsc --noEmit | exit 0 |
| vitest run | 189/189 PASS baseline |
| git diff prisma/schema.prisma | EMPTY diff (NG1) |
| Scope hygiene | git status staged — 0 env/ndjson/log/reports files |
| Commit SHA match | local HEAD SHA == ls-remote refs/heads/main exact |
| 16 TRUTH guards | stdout banner present; never weakened a guard; only valid PASS inputs |
| Policy + preset guard | no writes for non-preset IDs (N/A since we only route to 6 presets) |

## Risks
- **Neon cold P1008 transient socket:** Mitigation — daemon has built-in neonPing. If fails, re-run wrapper once.
- **Env still not active after wrapper export:** Mitigation — check probe script OWNER_HANDS_FREE_POLICY section post-write (names-only; never values). If still UNSET, wrapper uses `process.env.X = 'true'` before fork so child inherits (child_process by default copies parent env).
- **MA/MAD SEPA EU rejection:** Already fail-closed by design (Attijari PSD2 core rejects MA-IBAN). Falls back to Rail B MAD manual → correct.
- **Idempotency if run across minute boundary:** Mitigation — two back-to-back tick runs at step 5; if minute rolls over, add step 5bis instant rerun for IDEM within same minute-floor.
- **Non-preset scope leak:** Mitigation — fail-closed check present in every release-engine auto function (handsFreePolicyActive() && isHandsFreeOwner()); code review + test coverage ensures.
- **Git commit leaks secrets:** STRICT EXCLUSION list at step 9; `git status --porcelain` review before commit.
