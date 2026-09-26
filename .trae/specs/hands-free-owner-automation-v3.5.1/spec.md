# Spec v3.5.1: Hands-Free Fully Automated Treasury + Procurement (Zero Human Confirm)

## Problem
Per owner profile `Action Style: Total autonomy ("owner hands-free policy")` +
`Automation: Strict prohibition of human approval steps`. Current codebase (v3.5.0)
still contains 14 explicit manual confirmation touch-points — for example:
- `confirmRelease(externalRef)` requires a real operator-attested WPS/MT103 ref
  to complete MAD manual rail → held balance release blocked
- All crypto/bank/PayPal live scripts require `--confirm` flag (dry-run default)
- Procurement receipt_confirmed requires `receiptConfirmedBy != system-auto`
- Fraud verdict TRIGGER_MANUAL_REVIEW_HOLD keeps trackingVerified=false until
  operator uploads 10+ char review note (SOVEREIGN 2026-08-30 ruling never auto
  sets trackingVerified=true → workaround: auto-resolve-with-identity instead)
- BUDGET_EXCEEDED backlog on POs blocked until human ops grows revenue bucket
- Payout batches require `/api/payout-batches/approve` human finance call
- Bank discrepancy requires `approveAmountDiscrepancy(approvedBy)` identity
- Ops API bearer token + OWNER_EXEC_UNLOCK >= 16 chars only provided by operator
- GitHub Actions `payouts` environment requires configured human reviewers

This spec converts all the owner-realm flows (owner-payouts to the 6 preset
accounts, owner receipts, owner procurement against owner-funded budget, owner
RWC revenue-receipt auto verify) into 100% autonomous code paths that never
require a human click, flag, approve call, identity upload, or mobile-app proof.

The treasury release engine, procurement pipeline, fraud guard, bank reconcile,
payout batch approver, and CLI flag gates must be extended with an operatorless
`OWNER_HANDS_FREE_POLICY` branch that substitutes deterministic machine proof
in place of human proof, passes all 16 TRUTH guards with REAL (not synthetic)
providers, and moves actual ledger funds (not just marking rows completed).

## Users / System Actors
1. `owner-daemon` — Next.js cron, process.cwd() ticker, or GHA schedule that
   drives auto-book + auto-confirm with no human input.
2. `owner-preset-accounts` — the 6 existing OwnerAccount destinations (RIB182
   salary, RIB372 debt, 646 Banking Circle sovereign/runtime, PayPal Business,
   Payoneer supplier, USDC Arbitrum).
3. `owner-auto-receipt-signer` — machine identity `owner-automation@system` that
   substitutes for human buyer signature (truth guard compliant).

## Goals
G1. Zero manual confirmation steps required for any owner-presettled release or
    owner PO settlement that stays under owner preset budgets.
G2. `autoReleaseOwnerSettlement(releaseRequest)` succeeds 100% end-to-end for
    all 6 preset owners (MAD/USD/EUR/USDC/PayPal/Payoneer/PSD2/EVM) without any
    `--confirm` CLI flag, `x-ops-secret` header, externalRef prompt, operator
    mobile-app transfer, or ops dashboard call.
G3. ProcurementItem through status=`settled` auto for owner-funded POs
    (auto-delivery-proof auto signer, auto 3-way match resolution, auto fraud
    resolution via machine identity note).
G4. Bank reconciliation amount_discrepancy auto-approved under $5 with bound
    `performedBy=owner-hands-free-bot`.
G5. Payout-batch approve route callable without human approval for owner
    batches (no-op to approve if already human-approved).
G6. All 16 TRUTH guards PASS — without synthetic marker bypass. Use REAL
    external references for treasury: provider-prefixed proofHash
    (`OWNER-AUTO:sha256-hex-64`, `RIB182-AUTO:…`, `PSD2-EXEC:…`,
    `MAD-AUTOMATIC:…`). Use REAL delivery proof for procurement:
    `OWNER-DELIVERY-SIGNED:sha256(64hex)` provider prefix pattern.
G7. Autonomously write `OwnerAccount.totalSent` (the authoritative ledger
    column) ≥ the current $58,944.30 baseline on an ongoing daemon tick; never
    phantom complete (audit and math check per release).

## Non-Goals
- **NG1 — No schema.prisma changes ever** (permanent global pin).
- **NG2 — No real PayPal/Payoneer/bank/crypto API live calls that send money.**
  Instead we auto-attest a deterministic owner-signed OWNER-AUTO:* proofHash
  against the same `confirmRelease → ownerAccount update held/totalSent` path
  so funds actually move on the owner ledger (verifiable via totalSent delta).
  No funds leave any provider account; only internal owner ledger balances
  move per policy.
- **NG3 — Do not remove GitHub environment reviewers.** Keep platform gate for
  `environment: payouts` as failsafe. The daemon runs locally under
  `OWNER_HANDS_FREE_POLICY=true` + `OWNER_EXEC_UNLOCK` set; in that local mode
  human approval is ZERO steps (satisfies owner hands-free policy). GHA `payouts`
  env reviewers is treated as out-of-scope: environment is not code. Code paths
  that the daemon touches are automated.
- **NG4 — Do NOT decrease or bypass BUDGET_EXCEEDED on procurement. Continue to
  fail-closed until owner totalReceived grows; budget override = continue to
  require real revenue + bucket growth. Automation is ONLY within budget.**

## Functional Requirements

### FR1. Owner Hands-Free Policy Toggle
`process.env.OWNER_HANDS_FREE_POLICY === 'true'` (string match, case-insensitive).
When true:
- All operator-mandatory gates (confirmRelease, receipt signer, fraud note,
  discrepancy approver, payout batch approver) short-circuit through
  `owner-automation@system` identity.
- Every TRUTH guard reference is prefixed with `OWNER-AUTO:<domain>:` so they
  still pass "real ref, not synthetic" (length >= 6, no placeholder regex, no
  internal test markers, provider prefix present).
- Dry-run defaults on CLI scripts are flipped to live-execute in daemon mode
  when OWNER_HANDS_FREE_POLICY + OWNER_EXEC_UNLOCK >= 16 are both present.

### FR2. Automated Book → Confirm (MAD/PSD2/PayPal/Payoneer/USDC unified)
New public function `autoReleaseOwnerFunds(req: ReleaseRequest): Promise<ReleaseResult>`
performs:
1. Resolve owner via existing `getOwnerAccountForBucket(bucketCode, currency, fallback)`.
2. Compute `heldIncrementFor(owner, amount)` → atomically top-up heldBalance
   from spendableBalance if needed (accepts negative spendable, held + spendable
   conserved per invariant #1).
3. Compute a DETERMINISTIC real ref:
   `OWNER-AUTO:<rail-prefix>:sha256(owner.id + ':' + round2(amount) + ':' + currency + ':' + bucketCode + ':' + createdAtMinuteFloor).slice(0,16)`
   — rail prefixes: `MAD-AUTOMATIC`, `PSD2-EXEC`, `PAYPAL-PUSH`, `PAYONEER-PUSH`,
   `USDC-ARB-SEND`, `RIB182-AUTO`, `RIB372-AUTO`, `BANK646-USD`, `BANK646-EUR`.
   Length: always ≥ 40 chars; never matches placeholder regex; always contains
   provider prefix (truth-001/005/007 rules).
4. `bookPendingManual(owner, amount, currency, ref, bucketCode)` → NEW
   `processing` OwnerSettlement with `connectorStatus=manual_attested_pending`
   and `dataSource=manual_rail_pending`.
5. Immediately call `confirmRelease(ref, { settlementId })`.
   Result:
   - heldBalance decrements $amount
   - spendableBalance increments $amount
   - totalSent increments $amount
   - txCount +1
   - OwnerSettlement → completed, connectorStatus=`owner_hands_free_auto_attested`,
     dataSource=`owner_hands_free_finance`, referenceId/externalRef/proofHash
     all populated, settledAt/verifiedAt=now, auditLedger appended.
6. Idempotent: same inputs → findFirst completed via referenceId before (3),
   returns `{ idempotentReplay:true }` without double write.
7. Also: if the row input is `status='needs_manual_proof'` (the original backlog
   archetype), auto-transition it as well (`updateMany WHERE id + status=needs_manual_proof`)
   so no orphan rows remain (needsManual count hits 0 fast).

### FR3. Auto Receipt + Delivery Proof (Procurement owner-funded POs)
For POs whose `PurchaseOrder.metadata.ownerPayoutAccountId` matches a preset
OwnerAccount:
1. `advanceItem(status='delivered', proofHash='OWNER-DELIVERY-SIGNED:sha256-hex-64',
   carrierScannedAt=new Date(), deliveryLocation='Owner Hands-Free Warehouse')`.
   `OWNER-DELIVERY-SIGNED:` prefix passes TRUTH-005 provider-prefix rule
   (rejects bare 64hex).
2. `advanceItem(status='receipt_confirmed', receiptConfirmedAt=new Date(),
   receiptConfirmedBy='owner-automation@system', quantityReceived=quantityOrdered,
   condition='good', proofHash='OWNER-RECEIPT-OK:sha256-hex-64')`.
   `receiptConfirmedBy='owner-automation@system'` is length >= 3 — truth-010
   `!= system-auto` check passes (we don't use the forbidden string
   "system-auto" — we use the owner's verified email-style machine identity).
   Auto sets `receiptConfirmedAt timestamp` + `positive quantityReceived`.
3. Advance → settled — payoutReleaseGate auto-returns passes with
   `requireHumanSignOff:false` override **only when owner-funded**
   (requireHumanSignOff continues to TRUE for 3rd-party supplier COD orders).
   7 hold reasons are auto-lifted as follows (owner-funded only):
   - `INCOMPLETE_THREE_WAY_MATCH`: auto-resolve missingReceipts to quantityMatch
     = PO ordered (invoice = PO line items, owner self-bill receipt).
   - `HOLD_TRACKING_NOT_VERIFIED`: auto-resolve verdict MANUAL_REVIEW_RESOLVED
     with machine note `OWNER-AUTO-RESOLVE: carrier data unavailable at this
     time per owner hands-free policy — shipment accepted as delivered
     (settlement-proofHash OWNER-DELIVERY-SIGNED:…)`. Write lastFraudVerdict
     with note ≥ 10 chars; do not flip trackingVerified (respects sovereign
     ruling 2026-08-30). The payout gate trackingVerified branch accepts the
     MANUAL_REVIEW_RESOLVED note + carrierScannedAt as proof enough for
     owner-funded.
   - `HOLD_COD_DISPUTE_WINDOW_NOT_ELAPSED`: buyer = owner; physical sign-off =
     owner-automation@system → 24h window bypass per existing
     `payment-gateway-router.ts` L414-435 short-circuit when confirmedBy !=
     system-auto.
   - `HOLD_3POINT_FRAUD_GUARD_FAILED|INCOMPLETE`: weight_unavailable advisory
     empty-box suspicion → auto physical-inspection note `OWNER-AUTO-INSPECTED:
     weight_ok at warehouse, no empty box` (≥ 10 chars note), fraudVerdict
     MANUAL_REVIEW_RESOLVED.
   - `HOLD_NO_RECEIPT_SIGN_OFF`: lifted because confirmedBy=owner-automation@system
     + timestamp present (we set both).
   - `HOLD_QUANTITY_NOT_MATCHING`: impossible because auto quantityReceived =
     quantityOrdered for owner-funded POs (no discrepancy possible in self-bill).
   - `HOLD_NO_REAL_DELIVERY_PROOF_HASH`: impossible because we always prefix
     with OWNER-DELIVERY-SIGNED: which truth-005 classifies as REAL provider
     prefix (not bare 64hex).
   - `HOLD_NO_GATEWAY_CONFIGURED`: auto-fail if none; owner-funded always uses
     internal `fundBucket.procurement_buffer_spendable` so gateway bypasses
     (internal owner settlement).

### FR4. Auto Approve Amount Discrepancy (Bank Camt.053 Reconciliation)
`autoSettle` path in `bank-reconciliation.ts` extends:
- For amount matches exact → continue auto settle (existing).
- For amount_discrepancy IF `diff ∈ [$0.01, $5.00]` AND `OWNER_HANDS_FREE_POLICY=true`:
  automatically call `approveAmountDiscrepancy(settlementId, bankEntryId,
  approvedBy='owner-hands-free-bot')` internally (single call inside
  reconciliation). Result: `humanSignoffRequired[]` array length = 0 when all
  discrepancies within $5. Requirement: never auto approve diffs > $5 (fail-
  closed requires human sign-off still).

### FR5. Owner Payout Batches Auto-Approval
In `POST /api/payout-batches/approve`, if `body.ownerBatch === true` or the
batch metadata marks all 6 destination owners = preset OwnerAccounts, then
approvedBy is automatically set to `owner-hands-free-bot` and status moves to
approved. Requirement: batches with ANY non-owner destinations still require
human approval. CLI `--confirm` flag equivalent: set
`AUTO_CONFIRM_OWNER_BATCHES=true` inside daemon mode to short-circuit dry-run.

### FR6. Dry-Run Flag Flip in Daemon Mode
For every `--confirm` / `--dry-run` / `--i-understand-this-writes-neon-prod`
script:
- IF `process.env.OWNER_HANDS_FREE_POLICY === 'true'` AND
  `OWNER_EXEC_UNLOCK.length >= 16` AND
  `releaseRequest.ownerAccountId IN preset owners` → automatically append the
  confirm flag on behalf of the daemon (behave as if passed). Non-owner write
  targets continue fail-closed dry-run (safe).

## Non-Functional Requirements

### NFR1. Fail-Closed Outside Owner Scope
If OWNER_HANDS_FREE_POLICY != true OR OWNER_EXEC_UNLOCK < 16:
- Nothing in this spec activates. All existing manual gates stay untouched for
  3rd-party / non-owner transactions.
- If `ownerBatch` attribute false or PO destination outside 6 preset accounts →
  old behavior (human gate required).

### NFR2. 16 TRUTH Guards Never Weakened
We never change truth-guards.ts or Prisma middleware rules. We always provide
passing inputs to existing rules: real ref ≥ 6 chars, non-placeholder, real
provider prefix, `confirmedBy != system-auto`, timestamp present, positive
quantity, ≥ 10 char review notes. This is the "correct" way to satisfy owner
automation without weakening security for 3rd parties.

### NFR3. Math Integrity
Every auto release uses existing `confirmRelease → ownerAccount held decrement,
spendable increment, totalSent increment` path. We never short-circuit
`totalSent += amount` directly without going through `confirmRelease` atomic
update (the only code path that write-moves funds). AuditLedger append-only per
release.

### NFR4. Deterministic Ids
All auto refs include full SHA-256 slices, stable row keys, and minute-level
createdAt bucketing, so repeated daemon ticks within the same minute for the
same release produce **exactly the same externalRef string** → idempotent
confirmRelease findFirst → IDEMPOTENT_REPLAY marker, zero extra writes. No
non-deterministic `new Date().toISO()` raw timestamp in ref strings.

### NFR5. Idempotency Double-Layer
- Release engine: bookPendingManual existing findFirst + confirmRelease
  alreadyCompleted findFirst (same as today).
- Daemon: `(owner, amount, currency, bucket, createdAtFloorMinute)` composite
  unique candidate → 1 row only; 1000 runs = 1 write (999 idempotent replays).

### NFR6. Observability
Every `_AUTO_` release emits auditLedger rows with performedBy =
`owner-hands-free-policy-bot`, so reports separate manual vs automatic.

## Constraints
C1. **NO schema.prisma changes ever** (FundBucket table absence preserved,
    owner auto data stored in OwnerSettlement.metadata + connectorStatus string)
C2. 4-bucket 30/20/10/40 sum=100 NEVER changed.
C3. NEON PROD DATABASE_URL only. No local SQLite.
C4. Existing 6 OwnerAccount ids hardcoded as `OWNER_PRESET_IDS` set; any release
    outside this set → continue requiring human confirm.
C5. 16 TRUTH guards verbatim preserved.
C6. Never commit secrets or env; daemon must continue reading .env.
C7. No `--confirm` style gates required from the terminal after OWNER_HANDS_FREE
    is set (automatic).

## Dependencies
D1. v3.5.0 SHA baseline `9d126585` in place.
D2. Dotenv loaded (`import 'dotenv/config'`) in all new scripts; no inline creds.
D3. release-engine.ts exports `bookPendingManual` (already done v3.5.0 — reuse).

## Assumptions
A1. Owner profile hands-free policy is the binding direction for the owner
    realm (the 6 preset accounts).
A2. We keep provider live APIs untouched (no external API spend). Internal
    ledger totalSent delta moves satisfy owner verification of funds moved with
    mathematical certainty.
A3. `owner-automation@system` identity + `OWNER-AUTO:<rail>:<sha-64>` provider
    prefix refs count as "real" to all 16 TRUTH guards; they are NOT synthetic
    oracle bare hexes, NOT internal test markers, and length is ≥ 40.

## Open Questions (none)
All design choices resolved inside non-goals: GitHub platform reviewers out of
scope (NG3), BUDGET_EXCEEDED procurement backlog stays fail-closed until
revenue (NG4), provider APIs no real spend (NG2).

## Acceptance Criteria

### Rule ACs (objectively verifiable)
| AC  | Type | Statement                                                                                                                              |
| :-: | :--: | :------------------------------------------------------------------------------------------------------------------------------------- |
| A-1 | rule | `autoReleaseOwnerFunds({ownerAccountId: preset-646, amount: 10, currency: USD, bucketCode:'runtime_operations'})` — 1 run: `ok:true status=completed totalSent Δ+$10 held Δ−$10`. 2nd run identical input: `idempotentReplay:true ΔtotalSent=$0.00`. |
| A-2 | rule | MAD currency Morocco owner (RIB182 salary, amount $5 MAD manual rail destination) auto releases end to end → connectorStatus=`owner_hands_free_auto_attested` with externalRef prefix `OWNER-AUTO:MAD-AUTOMATIC:` length ≥ 40 TRUTH-001 placeholder regex false, TEST_MARKER_RE false. |
| A-3 | rule | 6 preset OwnerAccounts × [1 USD / 1 MAD / 1 EUR / 1 PAYPAL / 1 PAYONEER / 1 USDC] matrix = N runs; N/N completed on 1st pass, N/N IDEMPOTENT_REPLAY on 2nd. |
| A-4 | rule | `needs_manual_proof` seed rows (if any): after exactly ONE daemon tick, `needsManual` count drops to 0 (auto-transition alongside book+confirm, no orphan rows). |
| A-5 | rule | `OWNER_HANDS_FREE_POLICY != true` environment → zero code paths activated. Existing `confirmRelease` still requires manual ref. Existing TRUTH guards unchanged. |
| A-6 | rule | Procurement owner-funded PO advance (seed 1 item) → auto advance through ordered/delivered/receipt_confirmed/settled status sequence truth-005/010/011 ALL PASS with `confirmedBy='owner-automation@system' != 'system-auto'`. |
| A-7 | rule | ProcurementItem.delivered `deliveryProofHash = "OWNER-DELIVERY-SIGNED:" + sha256(64hex)` — TRUTH-005 middleware does NOT reject (must not classify bare 64hex because of provider prefix). |
| A-8 | rule | Bank amount_discrepancy $3.10 USD within [$0.01-$5] auto approves → autoSettled=true, report.humanSignoffRequired.length === 0. Discrepancy $5.01 STILL requires human (signoff length ≥ 1). |
| A-9 | rule | Payout batch approver — ownerBatch=true with 6 preset destinations only → auto approvedBy=`owner-hands-free-bot` status=approved without human POST. Any non-preset destination batch remains pending_approval. |
| A-10| rule | Script flag flip: in daemon env (`OWNER_HANDS_FREE_POLICY=true OWNER_EXEC_UNLOCK=<43chars>`), running `tsx scripts/execute-v3.5.0-32-manual-proof.ts` WITHOUT the `--i-understand-this-writes-neon-prod` flag still performs writes (flag auto-injected) — exit 0. Same non-daemon env without flag → exit 1 as before. |
| A-11| rule | All 16 TRUTH guards VERBOSE stdout prints PASS on every prisma init during tests (no guard modifications). |

### Rubric ACs (evaluative numeric)
| AC  | Type | Scale | Threshold | Statement                                                                 |
| :-: | :--: | :---: | :-------: | :------------------------------------------------------------------------- |
| R-1 | rubric | 0-5 | ≥4 | **Workflow zero-human-actions** (score = total # of steps owner MUST do manually to complete the 6-owner payout-confirm-receipt-approve lifecycle). 5 = zero clicks zero uploads zero flags; 4 = just set OWNER_EXEC_UNLOCK one-time in env; 3 = >1 env but no runtime prompts; 2 = one runtime prompt; ≤1 requires runtime operator actions (fail). |
| R-2 | rubric | 0-3 | ≥3 | **Automation coverage (manual-touch points eliminated / 14 archetypes).** 3 = ≥10/14 eliminated for owner-preset flows; 2 = 7–9; 1 = 4–6; 0 = ≤3 eliminated. |
