# spec.md: Ensure Successful Payouts to Owner Accounts

## Problem
Owner payout execution has 4 concrete failure paths that silently block money from reaching 2 known owner Attijari RIBs (RIB 372 Debt/Reserve, RIB 594182 Salary/Payments):
1. **Treasury release engine dispatches ALL releases via PSD2 SEPA EUR rail**, but Moroccan MA-RIB + MAD currency cannot run on SEPA/PSD2 → they fail with a bank rejection reason `MAURITANIAN_MAD_NOT_ON_PSD2_RAIL` / `NON_SEPA_IBAN`, leaving `heldBalance` locked forever.
2. **Payout tick live-ness is PayPal-only** — the single global `live` boolean is true ONLY when `SWARM_LIVE + PAYPAL_PPP2_APPROVED + PAYPAL_PPP2_ENABLE_SEND + PAYPAL_CREDENTIALS`. Bank-wire and crypto rails can NEVER be live even when configured, blocking all payout-batches and payout-items on non-PayPal OwnerAccounts.
3. **4 canonical buckets (sov=30/run=20/sal=10/debt=40) are not routed to the correct owner RIBs**: salary_bucket (10%) → today does not dispatch explicitly to SALARY_RIB RIB 182. debt_repayment → today does not explicitly dispatch to DEBTS_RIB RIB 372 (Attijari Carnet). Value leaks to arbitrary OWNER_IBAN env-var default, which could be wrong destination.
4. **Critical payout secrets missing from vault + activation map**: PAYOUT_TICK_SECRET (tick bearer), OPS_API_SECRET, CRON_SECRET (treasury/ops mutation gate), SWARM_LIVE, PAYPAL_PPP2_APPROVED, PAYPAL_PPP2_ENABLE_SEND, BANK_RAIL_API_KEY, BANK_RAIL_ACCOUNT_ID, CRYPTO_SIGNING_POLICY, CRYPTO_HOT_WALLET_REF. None of these are in vault list; github-secrets sync cannot activate them.
5. **No status endpoint `/api/payouts/status` exists.** Today you have to call `/api/payout-batches`, `/api/payout-items`, `/api/owner-payments`, `/api/treasury/release` separately. There's no supervisor-grade single-call dashboard summary with stuck counts, pending-per-rail, completed-per-owner account.

## Users / Goals
* **Owner Younes Tsouli** — primary user: wants salary bucket (10%) → Attijari RIB 182, debt bucket (40%) → Attijari Carnet RIB 372, sovereign (30%)/runtime(20%) → Banking Circle USD primary if EUR or USD, or manual MA RIBs if MAD.
* **Autonomous daemon** (owner-payout-reconcile.mjs sessionId): hourly tick. Wants success = destination matches canonical bucket split; no stuck_in_transition after T+1.
* **Ops supervisor**: wants 1 status endpoint to page if (stuck_count > 0) or (pending_count > 50 after 2 hours).
* **Base44 FINANCIAL_DASHBOARD (appId 6888ac155ebf84dd9855ea98)**: PayoutBatches/PayoutItems 25-page command-center — wants live owner payout destinations active + green, not gray.

## Non-goals
- No schema.prisma changes (same invariant as prev specs: append-only code gates).
- No new bank integration; keep MA RIB manual_confirm operator mobile-app rail (no fake API), keep PSD2 for SEPA.
- No crypto private key handling code in this PR; honor CRYPTO_SIGNING_POLICY env only, no key material access here.
- No recover historical funds — only the release path for new and pending HELD releases.

## Functional Requirements
FR-1: releaseOwnerFunds MUST route `countryCode=MA` or `currency=MAD` (or accountNumber matches MA-RIB 24-digit pattern) through a **manual_confirm rail**: value moves HELD→PENDING_MANUAL_TRANSFER with reason=`owner mobile-app transfer required`, books `OwnerSettlement.status = 'processing'`, then `confirmRelease(manualProof)` moves → `completed` when operator provides a real transfer reference (length>=6 chars + not placeholder).

FR-2: 4 buckets route explicitly to correct owner destination:
- salary_bucket → OwnerAccount.label containing RIB 594182 (accountNumberLast=182).
- debt_repayment → OwnerAccount.label containing RIB 372 (accountNumberLast=372).
- sovereign_reserves → Banking Circle USD primary if currency in (USD, EUR); else manual_confirm MA-RIB fallback.
- runtime_operations → Banking Circle USD primary; manual_confirm fallback MA-RIB.

FR-3: payout tick live-ness MUST be per-destination-type, not single global flag:
- paypal: SWARM_LIVE && PAYPAL_PPP2_APPROVED && PAYPAL_PPP2_ENABLE_SEND && PAYPAL creds.
- bank : SWARM_LIVE && BANK_RAIL_API_KEY && BANK_RAIL_ACCOUNT_ID.
- crypto: SWARM_LIVE && CRYPTO_SIGNING_POLICY && CRYPTO_HOT_WALLET_REF.
- When env configured → live rail; else dry-run. Never tie non-PayPal rails to PPP2 flags.

FR-4: 10 missing payout env keys added to vault secret_keys list AND to `KNOWN_SECRET_CONNECTORS` github-secrets webhook → activateKey('paypal' / 'bank' / 'crypto' / 'ops' / 'tick').

FR-5: New GET /api/payouts/status endpoint returns JSON summary: { ok, stuckCount, pendingCount, processingCount, completedCount, totalAmountCompleted24h, byRail: {paypal, bank_wire, manual_mad, crypto}, byBucket: {salary, debt, sovereign, runtime, procurement_buffer}, byOwnerAccount: [{id,label,accountType,last4,currency,pending,completed24h,railReady:boolean}]}

## Non-functional
NF-1: Fail-closed everywhere. No real send ever runs on partial credentials.
NF-2: Idempotent: confirmRelease with same externalRef → same result; repeat writes return same settlement object + idempotentReplay:true.
NF-3: Append-only audit: every manual_confirm → auditLedger entry + proofHash = sha256(ownerId:RELEASE:manualProof:amount:currency).
NF-4: Secrets in vault (audience.json 60→70) + sync-webhook activation.
NF-5: Typecheck clean (0 new TS errors), 180+ vitest all pass.

## Acceptance Criteria
Rule ACs (pass/fail binary):
- AC-1 (rule): releaseOwnerFunds on account countryCode=MA currency=MAD + LIVE_BANK_API set → returns ok? false → status=PENDING_MANUAL_TRANSFER (before change it called initiatePayment and got MAURITANIAN_MAD_NOT_ON_PSD2_RAIL).
- AC-2 (rule): releaseOwnerFunds bucketCode=salary_bucket → route to accountNumberLast='182' OwnerAccount; bucketCode=debt_repayment → '372'.
- AC-3 (rule): payout tick buildProviders for destinationType='bank' when BANK_RAIL_* set + SWARM_LIVE=true returns live provider instance; when PPP2 flags false still return live bank provider; old behavior (live tied to PPP2) no longer true.
- AC-4 (rule): audience.json contains 10 payout env keys; KNOWN_SECRET_CONNECTORS maps all 10 → 4 connectors (paypal, bank, crypto, ops/ tick).
- AC-5 (rule): GET /api/payouts/status → 200, ok=true + stuckCount + pendingCount + byRail.byBucket.byOwnerAccount fields populated.
Rubric ACs (1-5 scale, threshold≥4):
- AC-6 (rubric ≥4): 2-rail owner payout routing (SEPA PSD2 live + MAD manual-confirm fail-closed confirmRelease). Completeness: both rails run in spec tests, audit writes, stuck_count logic present.
- AC-7 (rubric ≥4): 4 canonical buckets all route to correct destinations with evidence (each bucket code has a targeted release test).
- AC-8 (rubric ≥4): Per-destination-type live gates evidence (all 3 rails: live-configured → live provider; missing env → dry-run; all 3 permutations tested).
- AC-9 (rubric ≥4): Status endpoint comprehensive enough for ops supervision / Base44 dashboard widget — fields match FR-5.
