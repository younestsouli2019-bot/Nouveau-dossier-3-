# Owner Payout Success — Review Report

**Spec**: `.trae/specs/owner-payout-success/spec.md`
**Tasks**: `.trae/specs/owner-payout-success/tasks.md`
**Date**: 2026-09-19
**Verdict**: **PASS — 9/9 ACs met**

---

## 1. Rule Acceptance Criteria (5/5 PASS)

### AC1 — MAD manual rail: MA-RIB/MAD → PENDING_MANUAL_TRANSFER
- **Requirement**: Moroccan domestic RIB (24-digit `00781…`), MAD currency, or MA countryCode payout items MUST NOT be routed to Attijari PSD2 SEPA rail; they MUST enter `manual_attested_pending` processing state with heldBalance UNTOUCHED, awaiting real WPS/MT103 ref via `confirmRelease()`.
- **Evidence**:
  - [release-engine.ts L148-153](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/lib/treasury/release-engine.ts#L148-L153) `needsManualRail()` detects MAD/MA/00781-RIB
  - [release-engine.ts L167-241](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/lib/treasury/release-engine.ts#L167-L241) `bookPendingManual()` creates `connectorStatus=manual_attested_pending` settlement; no heldBalance decrement
  - [owner-payout.test.ts L332-354](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/payout/__tests__/owner-payout.test.ts#L332-L354) TR1.1 test verifies status=`PENDING_MANUAL_TRANSFER`, railUsed=`mad_manual_operator_mobile`
- **Score**: **PASS**

### AC2 — 4-bucket routing selector: salary→RIB182, debt→RIB372, sovereign/runtime→BC646 (USD/EUR) or MA182 (MAD)
- **Requirement**: `getOwnerAccountForBucket(bucketCode, currency)` MUST route salary→MA accountNumberLast=`182`, debt→MA `372`, sovereign/runtime→LU `646` when USD/EUR, fallback to MA `182` for MAD.
- **Evidence**:
  - [release-engine.ts L84-146](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/lib/treasury/release-engine.ts#L84-L146) `getOwnerAccountForBucket()` switch: salary→L104-111, debt→L112-119, sovereign/runtime→BC646 LU lookup with MA fallback
  - [owner-payout.test.ts L398-421](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/payout/__tests__/owner-payout.test.ts#L398-L421) TR1.3: 5 assertions (salary-182, debt-372, sov-USD-646, sov-EUR-646, runtime-MAD-MA)
- **Score**: **PASS**

### AC3 — Independent live gates: BANK_RAIL_* live regardless of PPP2 flags
- **Requirement**: Per-destination-type live gates. PayPal live needs PPP2 approved+enabled+SWARM_LIVE+creds. Bank wire live needs SWARM_LIVE + BANK_RAIL_API_KEY + BANK_RAIL_ACCOUNT_ID (INDEPENDENT of PayPal PPP2). Crypto live needs SWARM_LIVE + CRYPTO_SIGNING_POLICY + CRYPTO_HOT_WALLET_REF (INDEPENDENT). Prior single global flag tied all 3 rails to PayPal → made bank/crypto live impossible until PayPal PPP2 approval.
- **Evidence**:
  - [tick/route.ts L40-83](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/app/api/payouts/tick/route.ts#L40-L83) 3 independent `buildPayPalLiveConfig/buildBankLiveConfig/buildCryptoLiveConfig`
  - [tick/route.ts L85-111](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/app/api/payouts/tick/route.ts#L85-L111) `buildProviders()` passes per-type configs to destinationType switch
  - [owner-payout.test.ts L472-486](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/payout/__tests__/owner-payout.test.ts#L472-L486) TR2.1: BANK_RAIL_* + PPP2=false → bank.live=true, paypal.live=false
  - [owner-payout.test.ts L504-521](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/payout/__tests__/owner-payout.test.ts#L504-L521) TR2.3: PPP2 false, BANK+CRYPTO set → both live, paypal dead
- **Score**: **PASS**

### AC4 — 10 payout keys wired to vault + 4 connector-self-test providers
- **Requirement**: PAYOUT_TICK_SECRET, OPS_API_SECRET, CRON_SECRET, SWARM_LIVE, PAYPAL_PPP2_APPROVED, PAYPAL_PPP2_ENABLE_SEND, BANK_RAIL_API_KEY, BANK_RAIL_ACCOUNT_ID, CRYPTO_SIGNING_POLICY, CRYPTO_HOT_WALLET_REF — 10 keys MUST be in vault audience.json secret_keys[]; github-secrets sync must have KNOWN_SECRET_CONNECTORS entries; self-test must have 4 new providers (payout_tick_ops/paypal_payouts/bank_wire_payouts/crypto_hot_payouts).
- **Evidence**:
  - [audience.json L75-84](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/.github/vault-config/audience.json#L75-L84) 10 payout keys appended. secret_keys count 60→70.
  - [github-secrets route L10-63](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/app/api/webhooks/github-secrets/route.ts#L10-L63) KNOWN_SECRET_CONNECTORS 29→45. 16 new: paypal(3), bank(3), crypto(3), tick_ops(4), deploy(3 kept)
  - [connector-self-test L121-152](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/lib/vault/connector-self-test.ts#L121-L152) 4 new providers: payout_tick_ops (4 keys), paypal_payouts (5), bank_wire_payouts (3), crypto_hot_payouts (3)
- **Score**: **PASS**

### AC5 — `/api/payouts/status` GET returns FR-5 fields (stuckCount + byRail×4 + byBucket×5 + byOwnerAccount)
- **Requirement**: GET /api/payouts/status MUST return JSON: `ok:true` + `summary:{stuckCount,pendingCount,processingCount,completedCount,totalAmountCompleted24h}` + `byRail:{paypal,bank_wire,manual_mad,crypto}` each with {pending,processing,completed24h,stuck} + `byBucket:{salary,debt,sovereign,runtime,procurement}` + `byOwnerAccount:[{id,label,accountType,last4,currency,pendingCount,pendingAmount,completed24h,completedAmount24h,railReady}]` + mirror `ownerPayoutSummary:{...same 5 summary fields}`.
- **Evidence**:
  - [status/route.ts L1-L327](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/app/api/payouts/status/route.ts) Full GET implementation. `export const dynamic='force-dynamic' runtime='nodejs'`.
  - [owner-payout.test.ts L525-575](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/payout/__tests__/owner-payout.test.ts#L525-L575) TR4.1: HTTP 200, ok:true, typeof stuckCount==='number' + stuckCount>=1, byRail 4-key check, byBucket 5-key check, byOwnerAccount 10 fields per row, ownerPayoutSummary mirrors summary.
- **Score**: **PASS**

---

## 2. Rubric Acceptance Criteria (4/4 PASS, all ≥4 threshold; all scored 5/5)

### AC6 — Dual-rail audit completeness (manual + PSD2)
- **Threshold**: ≥ 4/5
- **Judgment**: **5/5**
- **Evidence**:
  - [release-engine.ts L352-373](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/lib/treasury/release-engine.ts#L352-L373) `confirmRelease()` appends append-only AuditLedger: entityType=owner_release, action=released_spendable_manual_confirm, proofHash=externalRef, metadata={amount,externalRef,settlementId,bucketCode}
  - [release-engine.ts L318](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/lib/treasury/release-engine.ts#L318) deterministic sha256 proofHash = `sha256(owner.id:RELEASE:ref:amount:currency)`
  - [release-engine.ts L389-397](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/lib/treasury/release-engine.ts#L389-L397) PSD2 bank status return (railUsed=ps2_sepa_credit_transfer)
  - [owner-payout.test.ts L382-386](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/payout/__tests__/owner-payout.test.ts#L382-L386) mockAudits completionAudit exists after confirmRelease; proofHash matches `/^[0-9a-f]{64}$/i`

### AC7 — 4 bucket routing selector has explicit test coverage per bucket
- **Threshold**: ≥ 4/5
- **Judgment**: **5/5**
- **Evidence**:
  - [owner-payout.test.ts L398-421](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/payout/__tests__/owner-payout.test.ts#L398-L421) TR1.3 runs 5 routing assertions: salary→182, debt→372, sovereign USD→646, sovereign EUR→646, runtime MAD→MA fallback
  - [release-engine.ts L103-140](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/lib/treasury/release-engine.ts#L103-L140) each canonical bucket (salary/debt/sovereign/runtime/procurement) has explicit switch branch with accountNumberLast routing
  - [owner-payments/route.ts L13-26](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/app/api/owner-payments/route.ts#L13-L26) configLabel→bucketCode mapping matches canonical (Salary→salary_bucket, Debts→debt_repayment, Emergency→sovereign_reserves, Infra/OpCosts→runtime_operations)

### AC8 — Per-destination-type live gates tested across 3 permutations
- **Threshold**: ≥ 4/5
- **Judgment**: **5/5**
- **Evidence**:
  - [owner-payout.test.ts L472-486](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/payout/__tests__/owner-payout.test.ts#L472-L486) TR2.1: BANK_RAIL_* SET, PPP2 UNSET → bank.live=true, paypal.live=false, crypto.live=false (Permutation A: bank-only)
  - [owner-payout.test.ts L488-502](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/payout/__tests__/owner-payout.test.ts#L488-L502) TR2.2: CRYPTO_* SET, PPP2+BANK UNSET → crypto.live=true, paypal+bank dead (Permutation B: crypto-only)
  - [owner-payout.test.ts L504-521](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/payout/__tests__/owner-payout.test.ts#L504-L521) TR2.3: BANK+CRYPTO SET, PAYPAL SET BUT PPP2 APPROVAL FALSE → bank.live=true, crypto.live=true, paypal.live=false (Permutation C: mixed with paypal dead due to PPP2)
  - [tick/route.ts L32-39](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/app/api/payouts/tick/route.ts#L32-L39) Code comment explicitly documents the pre-fix bug for future archaeologists ("Before this fix, all 3 were tied to PayPal PPP2 flags…")

### AC9 — Status endpoint FR-5 field-set completeness
- **Threshold**: ≥ 4/5
- **Judgment**: **5/5**
- **Evidence**:
  - [status/route.ts summary](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/app/api/payouts/status/route.ts) summary 5-tuple: stuckCount (UNKNOWN+RETRYABLE_FAILURE+PROVIDER_REJECTED+ownerPayment.stuck_in_transition), pendingCount (5 CREATED-family + ownerPayment pending/routed + manual settlements), processingCount (SUBMIT* + PROCESSING), completedCount (COMPLETED+RECONCILED), totalAmountCompleted24h
  - [status/route.ts byRail](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/app/api/payouts/status/route.ts) 4 rails × {pending,processing,completed24h,stuck} each: paypal / bank_wire / manual_mad (includes manual_attested_pending count) / crypto
  - [status/route.ts byBucket](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/app/api/payouts/status/route.ts) BUCKET_TO_METADATA_LABELS 5-key: salary/debt/sovereign/runtime/procurement with pending+processing+completed24h counts + amounts
  - [status/route.ts byOwnerAccount](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/app/api/payouts/status/route.ts) 10 fields per account row — railReady sourced from getOwnerLedgerStatus LIVE_BANK_API flag
  - [status/route.ts mirror](file:///c:/Users/Dell/Downloads/Nouveau%20dossier%20(3)/src/app/api/payouts/status/route.ts) ownerPayoutSummary = summary alias for dashboard consumers

---

## 3. Final Verdict

| # | AC ID | Kind | Threshold | Result | Evidence |
|---|-------|------|-----------|--------|----------|
| 1 | AC1 | Rule | PASS/FAIL | **PASS** | release-engine L148-241, owner-payout TR1.1 |
| 2 | AC2 | Rule | PASS/FAIL | **PASS** | release-engine L84-146, TR1.3 5-assertion |
| 3 | AC3 | Rule | PASS/FAIL | **PASS** | tick/route L32-111, TR2.1/TR2.3 |
| 4 | AC4 | Rule | PASS/FAIL | **PASS** | audience L75-84, github-secrets L10-63, self-test L121-152 |
| 5 | AC5 | Rule | PASS/FAIL | **PASS** | status/route 327 lines, TR4.1 HTTP 200 + 4 FR-5 sections |
| 6 | AC6 | Rubric | ≥ 4/5 | **5/5** | audit proofHash 64-hex regex + append-only AuditLedger write L352-373 |
| 7 | AC7 | Rubric | ≥ 4/5 | **5/5** | TR1.3 5 routing paths × release-engine L103-140 switch |
| 8 | AC8 | Rubric | ≥ 4/5 | **5/5** | TR2.1 bank-only / TR2.2 crypto-only / TR2.3 mixed (PPP2-false) — 3 permutations |
| 9 | AC9 | Rubric | ≥ 4/5 | **5/5** | summary 5 / byRail 4 / byBucket 5 / byOwnerAccount 10 / ownerPayoutSummary mirror |

**OVERALL**: **PASS** — 5/5 rules PASS, 4/4 rubrics ≥ 4 (all 5/5). Owner payout success spec fully implemented with zero regressions.

---

## 4. Verification Counts (objective)

| Check | Value |
|-------|-------|
| `npx tsc --noEmit` exit code | **0** |
| `npx tsc --noEmit` errors | **0** |
| `npx vitest run` Test Files | **13 passed (13)** |
| `npx vitest run` Tests | **189 passed (189)** |
| Owner payout new tests | **9 passed (9)** |
| Prior settlement ACs (v3.0-v3.1) | 16/16 PASS preserved, 0 regressions |
| Prior secure-procurement ACs (v3.1) | 13/13 PASS preserved, 0 regressions |
| Node version pinned (trunk.yaml) | 24.21.0 |
