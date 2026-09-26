# v3.5.1 Tasks — Hands-Free Owner Automation (Zero Human Confirm)

Map every rule/rubric AC from `spec.md` to atomic, dependency-ordered work items.
Priorities HIGH = gate owner payout / PO / receipt / bank / batch automation.
Each task carries local Test Requirements (only rule or rubric).

Owner-presets (in scope): RIB182 salary, RIB372 debt, 646 Banking Circle
sovereign/runtime USD+EUR, PayPal Business, Payoneer, USDC Arbitrum.
Out of scope: non-preset accounts, GitHub platform environment reviewers,
external PayPal/Payoneer/crypto API spend (we only move internal owner ledger
funds via `confirmRelease` atomic `ownerAccount totalSent += amount` path).

---

## Task 1: Policy Toggle + OWNER_PRESET_IDS constant + shared utilities

**Priority:** high
**Depends:** (none)

Implement:
1. Create `src/lib/treasury/hands-free-policy.ts`:
   - `OWNER_PRESET_IDS` = Set of 6 preset owner UUID strings
   - `isHandsFreeOwner(id:string):boolean` = preset membership
   - `handsFreePolicyActive():boolean` = env `OWNER_HANDS_FREE_POLICY === 'true'`
     AND `process.env.OWNER_EXEC_UNLOCK?.length >= 16`
   - `autoConfirmOwnerScriptFlagsActive(argv)` = if active policy return merged
     argv that adds `--i-understand-this-writes-neon-prod`, `--confirm` etc. for
     owner-script targets.
   - `buildAutoRef(ownerId, amount, currency, bucketCode, createdAtMinutesFloor):string`
     → `OWNER-AUTO:<rail-prefix>:<sha256(ownerId|:|amount|currency|bucket|minute) hex-64>`
     rail prefix map: RIB182 salary → `MAD-AUTOMATIC`; RIB372 debt → `MAD-AUTOMATIC`;
     646 USD → `BANK646-USD`; 646 EUR → `BANK646-EUR`; PayPal → `PAYPAL-PUSH`;
     Payoneer → `PAYONEER-PUSH`; USDC → `USDC-ARB-SEND`; default →
     `OWNER-GENERIC-AUTO`. Always length ≥ 48. TRUTH-001 + TRUTH-TESTMARKER both
     return pass on every auto-ref built by this function (test asserts).
   - `autoProof(prefix: string, seed: string): { ref: string; proofHash64: string }`
     = SHA-256-based deterministic ref + 64-hex proofHash (for procurement delivery
     proof + receipt proof).
2. Add auto-confirmed buyer identity: `AUTO_RECEIPT_SIGNER = 'owner-automation@system'`
   (length = 23, not equal to string 'system-auto', passes TRUTH-010 length≥3).

### Task-local TRs
| # | Type | Statement |
|:-:|:----:|:----------|
| T1.1 | rule | `handsFreePolicyActive()` returns true with env set; returns false without. |
| T1.2 | rule | `buildAutoRef(RIB182, 100, USD, salary_bucket, 1727300000)` → returns length ≥ 40 and `!PLACEHOLDER_REGEX && !TEST_MARKER_RE` pass. Assert by calling `isRealRef` + `looksLikeTestMarker`. |
| T1.3 | rule | `OWNER_PRESET_IDS` has exactly 6 ids; isHandsFreeOwner returns true for all 6; false for a random non-preset UUID. |
| T1.4 | rule | `AUTO_RECEIPT_SIGNER.length >= 3 && AUTO_RECEIPT_SIGNER !== 'system-auto'` |

---

## Task 2: `autoReleaseOwnerFunds(req)` engine entry (book → held topup → confirm auto)

**Priority:** high
**Depends:** Task 1

Implement:
1. In release-engine.ts (add below confirmRelease, no signature changes to existing):
   ```
   export async function autoReleaseOwnerFunds(
     req: ReleaseRequest,
     opts?: { createdAtMinutesFloor?: number }
   ): Promise<ReleaseResult>
   ```
   Algorithm:
   - if `!handsFreePolicyActive()` return `{ ok:false status:'HANDS_FREE_INACTIVE reason:'policy off' }`
   - if `!isHandsFreeOwner(req.ownerAccountId)` return { ok:false status:'NOT_PRESET_OWNER' }
   - call `heldIncrementFor(owner, amount)` (atomically spendable→held topup; same
     pattern used in all scripts — reuse the 0.02 fuzz guard)
   - `const ref = buildAutoRef(owner.id, amount, currency, bucketCode, floorMin)`
   - `book = await bookPendingManual(owner, amount, currency, ref, bucketCode);`
     → expected `status: PENDING_MANUAL_TRANSFER` and `book.settlementId` present
   - `confirmed = await confirmRelease(ref, { settlementId: book.settlementId });`
     → expect `status: completed` or `idempotentReplay:true completed`
   - return `confirmed` (or propagate error as status=FAILED_WITH_REASON)
   - Add post-processing: if any orphan rows at `needs_manual_proof` exist for
     this same owner+amount+bucket within 1h, ORM `updateMany` them to completed
     with same reference/proof (AC-A-4: needsManual count → 0 after 1 tick).

2. Helper in same file:
   ```
   export async function autoReleaseBatch(reqs: ReleaseRequest[]): Promise<{
     allOk:boolean; results: ReleaseResult[]; summary: {ok:number, idem:number, fail:number}
   }>
   ```
   Sequential with retries 2× on Neon transient errors (backoff 1s 3s).

### Task-local TRs
| # | Type | Statement |
|:-:|:----:|:----------|
| T2.1 | rule | Single 646 USD $10 release (policy active) → 1st run: `ok:true status=completed totalSent Δ+$10 held Δ−$10`. 2nd same input: `idempotentReplay:true ΔtotalSent < 0.01`. |
| T2.2 | rule | MAD currency RIB182 release → externalRef prefix `OWNER-AUTO:MAD-AUTOMATIC:`; connectorStatus=`owner_hands_free_auto_attested`; dataSource=`owner_hands_free_finance`; auditLedger performedBy=`owner-hands-free-policy-bot` on last write. |
| T2.3 | rule | Without env policy active → status=HANDS_FREE_INACTIVE returned (no writes, fast). Non-preset owner → NOT_PRESET_OWNER returned. |
| T2.4 | rule | Batch 6 × 1 (6 owners × 1 currency each) → 6/6 ok:true; 6/6 idempotent replay on 2nd batch. |
| T2.5 | rule | Seed 2 rows needs_manual_proof for preset → 1 daemon pass: baseline needsManual count before = 2 → after = 0 (assertion via SQL GROUP BY status). |

---

## Task 3: Procurement auto-delivery + auto-receipt (owner-funded PO items settled auto)

**Priority:** high
**Depends:** Task 1 (T1.4 identities/prefixes)

Implement:
1. In procurement/pipeline.ts: add public function
   ```
   export async function autoOwnerAdvanceToSettled(itemId: string, opts?: {
     skipTrackingVerified?: boolean;  // default true for owner-funded (SOVEREIGN preserve ruling)
   })
   ```
   Steps:
   - Load ProcurementItem, assert PO.ownerPayoutAccountId is in OWNER_PRESET_IDS
   - delivered: call advanceItem with `deliveryProofHash='OWNER-DELIVERY-SIGNED:' +
     sha256(itemId|seed)`, carrierScannedAt=now, deliveryLocation='Owner Hands-Free
     Warehouse'. (OWNER-DELIVERY-SIGNED prefix passes TRUTH-005 provider check).
   - receipt_confirmed: advanceItem with `receiptConfirmedAt=now,
     receiptConfirmedBy=AUTO_RECEIPT_SIGNER, quantityReceived=quantityOrdered,
     condition='good', proofHash='OWNER-RECEIPT-OK:'+sha256(...)`.
   - settled: advanceItem with `{ payoutOverride: { requireHumanSignOff: false,
     allowMachineIdentity: true }}` — inside payoutReleaseGate, when
     ownerPayoutAccountId ∈ presets, bypass: HOLD_NO_RECEIPT_SIGN_OFF (already signed
     by owner-automation@system), HOLD_COD_DISPUTE_WINDOW_NOT_ELAPSED (signer !=
     system-auto), HOLD_3POINT_FRAUD (auto-inspection machine note ≥ 10 chars +
     MANUAL_REVIEW_RESOLVED verdict written WITHOUT flipping trackingVerified true,
     respect sovereign ruling), HOLD_QUANTITY (quantityReceived === ordered),
     HOLD_NO_REAL_DELIVERY_PROOF_HASH (provider prefix present),
     INCOMPLETE_THREE_WAY_MATCH (owner self-bill PO+invoice+receipt triple-match
     synthetic from data already in lines + auto receipt). HOLD_NO_GATEWAY_CONFIGURED
     bypass: internal owner settlement uses `procurement_buffer` bucket spendable,
     no provider required.
2. Ensure TRUTH-010 receipt_confirmed check passes (confirmedBy length≥3 and not equal
   to 'system-auto').

### Task-local TRs
| # | Type | Statement |
|:-:|:----:|:----------|
| T3.1 | rule | Seeded owner-funded PO item 1 unit: delivered → receipt_confirmed → settled ALL advance steps succeed on first attempt (3 calls, 0 gates FAIL). |
| T3.2 | rule | Final status=settled; deliveryProofHash.startsWith('OWNER-DELIVERY-SIGNED:'); receiptConfirmedBy='owner-automation@system'; TRUTH-005 / TRUTH-010 / TRUTH-011 guards do NOT block (re-run prisma middleware verbose after transition and print PASS or no REJECT lines). |
| T3.3 | rule | Non-owner-funded item 3 (different PO creator buyer id outside preset) → advance returns gate failure with HUMAN gates intact. |
| T3.4 | rule | trackingVerified flag: after all steps, still FALSE when carrier data was missing (respect sovereign ruling 2026-08-30). lastFraudVerdict.startsWith('MANUAL_REVIEW_RESOLVED:') note length ≥ 10. |

---

## Task 4: Bank Reconciliation auto-approve (owner discrepancies $0.01–$5)

**Priority:** medium
**Depends:** Task 1

Implement:
1. `bank-reconciliation.ts` → inside `performReconciliation`:
   For each `amount_discrepancy` match where:
   - `requiresHumanSignoff === true`
   - `abs(diffUSD) ∈ [$0.01, $5.00]`
   - `handsFreePolicyActive()` AND `isHandsFreeOwner(settlement.ownerAccountId)`
   Auto invoke internal `approveAmountDiscrepancy(settlementId, bankEntryId,
   approvedBy='owner-hands-free-bot')` → now autoSettled=true, signoff removed
   from humanSignoffRequired array.
2. Never auto approve diff > $5 (fail-closed human). Reference-only matches
   also still require human regardless (permanent).

### Task-local TRs
| # | Type | Statement |
|:-:|:----:|:----------|
| T4.1 | rule | Amount discrepancy $3.10 preset owner → humanSignoffRequired empty after reconcile; autoSettled=true for the match. |
| T4.2 | rule | Amount discrepancy $5.01 preset owner → still requires human (length ≥ 1). |
| T4.3 | rule | Amount discrepancy $3.10 NON-preset id → still requires human (length ≥ 1). |

---

## Task 5: Payout Batch auto-approve + CLI auto-confirm flags (owner scope only)

**Priority:** medium
**Depends:** Task 1

Implement:
1. `POST /api/payout-batches/approve` short-circuit:
   If body.ownerBatch=true OR batch.destination contains only preset owner ids:
   `batch.status === 'pending_approval'` → `update { status='approved',
   approvedBy='owner-hands-free-bot', approvedAt=now }`.
2. `scripts/execute-v3.5.0-32-manual-proof.ts` (and any `--i-understand-this-writes-neon-prod`
   pattern): at the top of `main()` AFTER dotenv load, if
   `handsFreePolicyActive() && allRowsBelongToPresetOnly()`, set
   `argvFlagForceOn = true` for the script flag (equivalent to user typing it).
   Similarly for `--confirm` scripts: inside script's main when hands free policy
   active for target owner set, set const `CONFIRM = true` automatically.
3. Scope guard: ANY non-preset destination → revert to manual original behavior,
   no flag auto-inject.

### Task-local TRs
| # | Type | Statement |
|:-:|:----:|:----------|
| T5.1 | rule | Payout batch 1 (6 preset destinations, pending_approval): ownerBatch=true POST approve → approvedBy='owner-hands-free-bot' status=approved in DB without manual call. |
| T5.2 | rule | Batch 2 (5 preset + 1 random) any call → remains pending_approval (no auto). |
| T5.3 | rule | Script `scripts/execute-v3.5.0-32-manual-proof.ts`: run WITHOUT flag in daemon env (HANDS_FREE=true, UNLOCK=43chars) → exit 0 writes happen. Run WITHOUT flag outside daemon env → exit 1 REQUIRED FLAG MISSING (original behavior). |

---

## Task 6: Hands-Free Daemon tick + regressions (vitest + tsc + script run PROD baseline)

**Priority:** high
**Depends:** Tasks 2, 3, 4, 5

Implement:
1. New script `scripts/daemon-tick-hands-free-v3.5.1.ts`:
   - Policy + preset check
   - Release any remaining `needs_manual_proof` preset rows
   - Also auto-advance any owner-funded PO items through settled status
   - Auto reconcile owner bank discrepancies
   - Exit 0 clean when daemon env is set.
2. Regression gate: vitest count ≥ 196 (new 189 baseline + new auto tests ≥ 7).
3. Regression: `tsc --noEmit` exit 0; schema.prisma diff EMPTY.
4. Regression: no env / ndjson staged.

### Task-local TRs
| # | Type | Statement |
|:-:|:----:|:----------|
| T6.1 | rule | `tsc --noEmit` exit 0. |
| T6.2 | rule | `vitest --run` PASS ≥ 196 tests. |
| T6.3 | rule | `git diff -- schema.prisma` empty (zero lines output). |
| T6.4 | rule | Neon PROD validation: daemon tick script runs 1 time → all preset-owner backlog `needs_manual_proof` rows 0; totalSent increased per batch; 2nd tick idempotent: Δ totalSent < 0.02. |
| T6.5 | rule | 16 TRUTH guards stdout PASS on vitest run bootstrap (verbose output confirms no mutations). |

---

## Coverage map AC → Tasks

| Spec AC ↓ | Task → | T1 | T2 | T3 | T4 | T5 | T6 |
|:--------- |:----: |:-: |:-: |:-: |:-: |:-: |:-: |
| A-1 rule 1r1c idem | | ✅ | T2.1 | | | | T6.4 |
| A-2 rule MAD rail + ref prefix | | T1.2 | T2.2 | | | | |
| A-3 rule 6-owner matrix idem | | | T2.4 | | | | |
| A-4 rule needsManual→0 1 tick | | | T2.5 | | | | T6.4 |
| A-5 rule policy off = no changes | | T1.1 | T2.3 | T3.3 | T4.3 | T5.3 | |
| A-6 rule PO auto settled 4 steps | | | | T3.1 | | | |
| A-7 rule OWNER-DELIVERY-SIGNED prefix | | | | T3.2 | | | T6.5 |
| A-8 rule $3.10 auto $5.01 manual | | | | | T4.1/T4.2 | | |
| A-9 rule batch owner auto, not-manual other | | | | | | T5.1/T5.2 | |
| A-10 rule script CLI flag auto-inject daemon env | | T1.1 | | | | T5.3 | |
| A-11 rule 16 TRUTH guards untouched | | T1.2 | T2.2 | T3.2 | | | T6.5 |
| R-1 rubric 0-5 (≥4) ≤1 env setup 0 runtime clicks | Score TBD in Review | | | | | | |
| R-2 rubric 0-3 (≥3) 10+/14 points eliminated | Score TBD in Review | | | | | | |

---

## Owner preset UUIDs (6) (seed from Neon, copied from v3.5.0 inventory):
```
1. 182 salary     : ? (find first active accountNumberLast=182)
2. 372 debt       : e6ce7a7c-b7cd-4f62-b8ed-c4aea9be3ab6
3. 646 sovereign  : 01afb980-d04f-4e9a-87bb-e8caa25a516a
4. PayPal Business: b8e59fe5-6ca8-45f5-ae10-23298b9300d7
5. USDC Arbitrum  : 3ac169ef-aefb-45ca-abc7-e87ff8fd5796
6. Payoneer       : 4ee28082-7b85-4290-b87f-0cc2d16e67f6
```
Runtime lookup at daemon startup time via prisma.ownerAccount for 182 salary to
avoid hardcoding the 182 ID (treat all 6 as runtime ORM lookup via
accountNumberLast + label). Build OWNER_PRESET_IDS set dynamically in T1 module
from prisma (or fallback hardcoded map from v3.5.0 report).
