# SPEC MODE #8 — Tasks.md: Implementation Queue

**AC Coverage Goal:** 13/13 acceptance criteria (100%).  
**Task Count:** 15 atomic tasks (T0–T14). 2+ test requirements (TR) per task minimum.

---

## T0: Runner skeleton + syntax verify (depends on: none)
**Status:** pending · **Priority:** high · **Covers AC:** AC-1 partial

### Description
Create `scripts/swarm-revenues-auto-route-v358.mjs` — file header, imports (node core only, 0 npm deps), CLI arg parser, 6 phase stubs: (P0) env/gate read, (P1) collect revenues, (P2) bucket split, (P3) dispatch order, (P4) HMAC chain write, (P5) exit code selection. Exit 0 on skeleton.

### Test Requirements
| # | Type | Pass Condition |
|---|------|----------------|
| TR-T0.1 | **rule** | `node --check scripts/swarm-revenues-auto-route-v358.mjs` exit 0. |
| TR-T0.2 | **rule** | Imported modules list ⊆ {'node:fs','node:crypto','node:path','node:child_process','node:url'}. No npm imports (verify grep count 0 'from \"[a-z]\"' without node: prefix or .mjs/.ts file extension → allowed only for internal project modules). |

---

## T1: Revenue source aggregator SANS-DB (depends: T0)
**Status:** pending · **Priority:** high · **Covers AC:** AC-7 (SANS-DB), AC-2 data input

### Description
Implement `collectSwarmRevenuesSansDb() = events[]` phase P1: parse `logs/swarm_clickless/latest.json` inbound-scout section, persist/compare `data/out/swarm-revenues-prev-state.json` settlement-worklist increases. Idempotence marker `swarm-auto-route-v358:fs:<eventKey>`.

### Test Requirements
| # | Type | Pass Condition |
|---|------|----------------|
| TR-T1.1 | **rule** | Mock `latest.json` inject 2 detected wires amount=$500 USD + $127.30 EUR. Aggregator returns array.length=2 with correct amounts. |
| TR-T1.2 | **rule** | Persist prev-state to `data/out/swarm-revenues-prev-state.json`, re-run same mock, assert length=0 on second run (idempotent). |

---

## T2: DB source aggregator (depends: T1)
**Status:** pending · **Priority:** high · **Covers AC:** AC-1, AC-6

### Description
Implement `collectFromDb()` optional: Neon RevenueEvent query status=completed LENGTH(proofHash)>=10, LEFT JOIN RevenueLedgerEntry rail='swarm-auto-route-v358' to dedupe. Idempotence marker `swarm-auto-route-v358:db:<reId>`. G2 fail → return empty array silently (no DB error).

### Test Requirements
| # | Type | Pass Condition |
|---|------|----------------|
| TR-T2.1 | **rule** | Unset DATABASE_URL env → call collectFromDb() — function returns [] with no throw, no stderr line matching 'FATAL|connection', exit still 0. |
| TR-T2.2 | **rule** | 2x consecutive run on same (mocked) pooled Postgres Neon: SELECT COUNT rows WHERE externalRef LIKE 'swarm-auto-route-v358%' → count identical run1/run2. |

---

## T3: CCXT + EVM delta sources (network read-only)
**Status:** pending · **Priority:** medium · **Covers AC:** AC-1, AC-5

### Description
Add P1 sources:
- Binance USDT delta via node fetch signed with Binance KEY/SECRET (G3 absent → skip)
- EVM wallet: settlement-worklist EVM probe across 6 L2 chains USDT deltas

Min/max duration: 15s timeout per fetch. Failure → honest reason log and treat that source as rail=QUARANTINED skip amount (don't double count).

### Test Requirements
| # | Type | Pass Condition |
|---|------|----------------|
| TR-T3.1 | **rule** | G3 absent (BINANCE_API_KEY empty) → No network fetch to api.binance.com occurs (stub out fetch, verify called URL count=0 for Binance). |
| TR-T3.2 | **rule** | EVM balance probe timeout 15s enforced. Inject slow RPC mock (sleep 18s) → function returns with available:false error:'rpc_timeout' within 20s wall time. |

---

## T4: BUCKET_PCT split pure function TDD vector
**Status:** pending · **Priority:** high · **Covers AC:** AC-2, AC-11

### Description
Implement pure `computeBucketSplit(netUsd)`:
- salary = 0.10 × net (2 decimals banker rounding)
- debt = 0.40 × net
- sovereign = 0.30 × net
- ops = 0.20 × net
- residual penny (net - sum) → added to salary ALWAYS
- Return object {salary, debt, sovereign, ops, total, delta}

Run vector 10 test cases: 127.30, 0.99, 5000.00, 6728.77, 8.08, 100.00, 0.01, 9999.99, 0.50, 420.69.

### Test Requirements
| # | Type | Pass Condition |
|---|------|----------------|
| TR-T4.1 | **rule** | ALL 10 vectors pass: Σ salary+debt+sovereign+ops = input amount ±0.00 (exact). |
| TR-T4.2 | **rubric** | 2 pts = residual penny correctly absorbed by salary on vectors where rounding drift applied (e.g., 0.99, 0.50, 8.08 — assert salary is the ONLY bucket receiving +$0.01 or +$0.02 adjustment). 1 pt = correct but mixed adjustment into ops bucket occasionally. 0 = wrong bucket absorbed. |

---

## T5: Bucket order dispatcher (order enforcement SAL→DEBT→SOV→OPS)
**Status:** pending · **Priority:** high · **Covers AC:** AC-3, AC-9

### Description
Create `dispatchByBucketOrder(splits, canSendFn, sendFn)`:
1. Invoke sequence order **exactly**: [salary, debt, sovereign, ops]
2. For each: `canSendFn(presetId)` → true → call `sendFn(bucket, amount, preset)`; false → call `quarantineFn(bucket, amount, reason)`
3. Return `{sent:[], quarantined:[], orderSequence:[]}`

Preset map: salary→RIB182, debt→RIB372, sovereign→BC646_SOV, ops→BC646_OPS.

### Test Requirements
| # | Type | Pass Condition |
|---|------|----------------|
| TR-T5.1 | **rule** | Mock 4 live canSend=all true. Assert `orderSequence` **exactly** `['RIB182','RIB372','BC646_SOV','BC646_OPS']`. Fail if any permutation (e.g., BC before RIB182 = FAIL). |
| TR-T5.2 | **rule** | Mock canSend: salary=false, others=true. Assert quarantine count=1 bucket=salary, sent order sequence=3 items = [debt,sov,ops] (preserve skip gap but order remaining relative SAL→DEBT→SOV→OPS preserved after skip). |

---

## T6: Rail canSend bridge (wrap payment-routing-table.mjs + signature)
**Status:** pending · **Priority:** high · **Covers AC:** AC-5, AC-10

### Description
Write `canSendPreset(presetId)` that bridges:
- Reads last `data/out/payment-routing-table.json` if present
- Falls back to honest gate-based answer: RIB182/RIB372 → Attijari PSD2 creds present? BC646_SOV/BC646_OPS → BankingCircle SDK user/pass/endpoint present? USDC L2 → TRUST_WALLET_PK set?
- Never returns TRUE without ≥ 1 real evidence. Always returns reason string ≥40 chars if FALSE.

### Test Requirements
| # | Type | Pass Condition |
|---|------|----------------|
| TR-T6.1 | **rule** | RIB372 (debt) with Attijari PSD2=absent → canSend=false, reason length ≥40 chars. |
| TR-T6.2 | **rule** | Cross-bucket guard: if `presetId=RIB182` AND caller passes bucket code != 'salary' → THROW 'CROSS_BUCKET_GUARD_VIOLATION' hard FAIL. (Prevents misrouting bugs.) |

---

## T7: Auto-signature bypass injection (--confirm auto-passthrough)
**Status:** pending · **Priority:** high · **Covers AC:** AC-4

### Description
Modify invocations in runner: when `BOTH` true `(HANDS_FREE && G1-G4)`:
- owner-payout-evm → prepend `--confirm` to args
- owner-payout-paypal → set env `AUTO_CONFIRM_PAYPAL_BATCH=true` (dry-run-off)
- auto-run-v354 → set env `AUTO_CONFIRM_OWNER_BATCHES=true`

If `EITHER` missing → dry-run-plan only written, never send (FAIL-CLOSED).

### Test Requirements
| # | Type | Pass Condition |
|---|------|----------------|
| TR-T7.1 | **rule** | G1-G4 pass, HANDS_FREE=true. Spawn owner-payout-evm subprocess — argv captured includes `--confirm` flag. Verify, NOT just env variable set. |
| TR-T7.2 | **rule** | G4 fail (UNLOCK short=10), HANDS_FREE=true. owner-payout-evm spawned WITHOUT --confirm. 0 real sends (dry-run only). No outbound network to RPC except gas balance read. |

---

## T8: Quarantine subsystem NDJSON + markers
**Status:** pending · **Priority:** high · **Covers AC:** AC-5, AC-10, AC-11

### Description
Implement quarantine writer:
- Append `data/out/swarm-route-quarantine.ndjson` lines format: `<tsISO>|bucket=<CODE>|amount=<n>|rail=<railID>|reason=<≥40chars>|HMAC=<64hex>`
- If DB gate open: write OwnerSettlement status=QUARANTINE with bucket-purpose marker, AuditLedger SWARM_ROUTE_QUARANTINE op.

### Test Requirements
| # | Type | Pass Condition |
|---|------|----------------|
| TR-T8.1 | **rubric** | 2 pts = 3 quarantine triggers across buckets (mock BC646 + RIB182 + RIB372 all dead). Produced 3 lines all reason.length ≥40 chars AND HMAC verify re-match. 1 pt = reasons 30-39 chars (border). 0 = <30 or no HMAC. |
| TR-T8.2 | **rule** | AC-10 cross-check: RIB182 dead, salary quarantined. Post audit: Grep `swarm-revenues-route-v358.ndjson` all lines bucket=debt → NONE have presetId='RIB182'. (Cross-bucket diversion ZERO count.) |

---

## T9: HMAC chain appender NDJSON integrity
**Status:** pending · **Priority:** high · **Covers AC:** AC-8, AC-11

### Description
Create `appendHmacChain(line)`: writes line to `data/out/swarm-revenues-route-v358.ndjson`.
- HMAC0 = sha256('SWARM-ROUTE-v358' + commit SHA HEAD)
- HMAC[i] = createHmac('sha256', OWNER_EXEC_UNLOCK || HMAC0-safe-fallback).update(HMAC[i-1] + line_body).digest('hex')
- Trailing append zeroize key buffer after write (T12 later)

### Test Requirements
| # | Type | Pass Condition |
|---|------|----------------|
| TR-T9.1 | **rule** | Sample replay on 12 written lines: indices 2, 5, 11 (last). Recalculate chain offline → all 3 match HMAC stored. |
| TR-T9.2 | **rule** | Swap any 1 character in line #7 → re-verify index 11 FAILS chain (tamper detection functional). |

---

## T10: SANS-DB plan mode + exit codes
**Status:** pending · **Priority:** medium · **Covers AC:** AC-7

### Description
When G2 (DATABASE_URL) absent OR any gate G1/G3/G4 FAIL, script enters PLAN MODE:
1. Writes `data/out/swarm-revenues-plan.json`: events, bucket splits, proposed sends, honest rail-live matrix (which rails dead, which alive)
2. NEVER executes send functions
3. Exit code = 0 if plan file written successfully

### Test Requirements
| # | Type | Pass Condition |
|---|------|----------------|
| TR-T10.1 | **rule** | Unset DATABASE_URL, unset BINANCE_API_KEY → G2+G3 FAIL. Run full script. Assert exit=0 AND grep plan.json 'rail_live_matrix' present. Grep stderr/stdout for 'fetch|POST|INSERT|UPDATE' → count 0. |
| TR-T10.2 | **rule** | Amounts inside plan.json bucket split still obey Σ = events total ±0.01 (split math applied even in plan mode). |

---

## T11: Wrapper autorotate→swarm→run-live-crypto lifecycle chain
**Status:** pending · **Priority:** high · **Covers AC:** AC-9

### Description
Edit `scripts/start-owner-hands-free.ps1` (L30-50 region): AFTER autorotate-pre-wrapper dot-source (Phase 0), ADD new Phase 0.5:
```powershell
# Phase 0.5 Swarm revenue auto route
& node "$PSScriptRoot\swarm-revenues-auto-route-v358.mjs" --owner-hands-free-mode
$swarmRouteExit = $LASTEXITCODE
if ($swarmRouteExit -ge 7) { Write-Error "FAIL-CLOSED: swarm route exit $swarmRouteExit (hard failure). Abort wrapper exit 5"; exit 5 }
if ($swarmRouteExit -eq 3 -or $swarmRouteExit -eq 0) { <# tolerate lock busy + success #> }
Write-Host "[PHASE 0.5] swarm-revenues-auto-route exit=$swarmRouteExit"
```

Tolerate ONLY exit 0 (OK) or exit 3 (LOCK BUSY). Anything ≥7 → abort wrapper exit=5 fail-closed.

### Test Requirements
| # | Type | Pass Condition |
|---|------|----------------|
| TR-T11.1 | **rule** | Static grep order: start-owner-hands-free.ps1 line index of autorotate < line index of swarm-route < line index of run-live-crypto-po.ps1. Verify sequence (file content order). |
| TR-T11.2 | **rule** | Mock swarm script exit 7. Wrapper propagates exit code 5 (abort). Mock exit 3 → wrapper continues. Mock exit 0 → continues. |

---

## T12: Zeroize buffers after HMAC/signing
**Status:** pending · **Priority:** medium · **Covers AC:** AC-11, AC-12

### Description
After HMAC key (OWNER_EXEC_UNLOCK buffer) usage, after env reads for secrets, fill buffers with `0x00` then shadow compare for 9 key buffers (DATABASE_URL, LIVE_BANK_API, BINANCE_KEY, BINANCE_SECRET, OWNER_EXEC_UNLOCK, UNBLOCK8 concatenated, HMAC prev key, HMAC current key, bucket split aggregate string).

### Test Requirements
| # | Type | Pass Condition |
|---|------|----------------|
| TR-T12.1 | **rule** | Node debugger snapshot / manual verification: zeroize fn called 9 separate invocations post usage. Assert shadow Buffer.compare return 0 (all zeroed) for each after. |
| TR-T12.2 | **rule** | Process-only. After full live run: PowerShell command verify GetEnvironmentVariable for 8 UNBLOCK8 keys in both User/Machine scopes = count 0 non-null. |

---

## T13: End-to-End dry-run dataset ($500 + $1500 events)
**Status:** pending · **Priority:** high · **Covers AC:** AC-2, AC-5, AC-6, AC-8, AC-10, AC-11 composite

### Description
Run end-to-end on 2 synthetic events: $500 eventA + $1500 eventB = $2000 net.
Mock all 4 rails = alive for FIRST run. Mock RIB182 = dead for second run (salary quarantine).

### Test Requirements
| # | Type | Pass Condition |
|---|------|----------------|
| TR-T13.1 | **rubric** | 2 pts = Run1 sent total = $2000.00 exactly ±0.01. Run 2 salary quarantined = $200 salary total. HMAC chain verified. All idempotence keys unique. 1 pt = amount 1-3 cent drift, chain OK. 0 = >5c or missing buckets. |
| TR-T13.2 | **rule** | Idempotence: Run the Run1 mocks twice (no RIB182 dead) → 2x run, OUTPUT NDJSON total line count = line count first run (duplicates rejected, no double send). |

---

## T14: Regressions — vitest + syntax + .keys/ leak check
**Status:** pending · **Priority:** high · **Covers AC:** AC-13

### Description
Run final regression gates:
- `vitest run` (expect 193/193 or ≥ 190 after acceptable additions)
- `node --check` on: t7 autorotate, swarm-revenues-auto-route-v358, autorotate-pre-wrapper, start-owner-hands-free, settlement-worklist, payment-routing-table
- `git ls-files .keys/` count 0

### Test Requirements
| # | Type | Pass Condition |
|---|------|----------------|
| TR-T14.1 | **rubric** | 2 pts = vitest 193/193 pass, all --check exit 0, .keys/ 0. 1 pt = vitest 190-192 or 1 syntax fail trivial comment. 0 pts = <190 vitest. |
| TR-T14.2 | **rule** | Commit SPEC8+runner files to index → `git ls-files .keys/` return empty list FAIL-CLOSED exit 5 IF any line returned. (Verify before commit.) |

---

## AC Coverage Matrix (13/13)
| AC | Covering Tasks |
|----|----------------|
| AC-1 Runner syntax 0 deps | T0, T1, T2, T3 · TRs = rule rules pass |
| AC-2 Split 10 vector math | T4, T10.2, T13 |
| AC-3 Bucket order dispatch | T5, T11.1 static order |
| AC-4 --confirm auto inject | T7 |
| AC-5 Quarantine 40-chars+rail dead | T6, T8, T13 |
| AC-6 Idempotence 3x runs | T2, T13.2 |
| AC-7 SANS-DB plan 0 net-write | T1, T10 |
| AC-8 HMAC chain sample 3 | T9.1, T13.1 |
| AC-9 Wrapper lifecycle fidelity | T11 |
| AC-10 Cross-bucket guard | T6.2, T8.2 |
| AC-11 Zero-Loss Σ=collected | T4.2, T8.1, T9, T12, T13.1 |
| AC-12 Process-only env | T12.2 |
| AC-13 Regressions vitest 193+ | T14 |

---

## Dependency Order Graph (linear recommended, all tasks high/medium listed)
```
T0 (skeleton)
 └─ T1 (FS sources)
    ├─ T2 (DB source)
    ├─ T3 (network sources)
    └─ T4 (split math)
       └─ T5 (dispatch order)
          ├─ T6 (canSend bridge)
          ├─ T7 (auto-signature inject)
          └─ T8 (quarantine sub)
             └─ T9 (HMAC chain)
                ├─ T10 (plan mode exit code)
                ├─ T11 (wrapper lifecycle edit)
                ├─ T12 (zeroize)
                └─ T13 (E2E synthetic)
                   └─ T14 (regressions final)
```
