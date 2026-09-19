# tasks.md: Owner Payout Success

Dependency order: (spec) → secrets-wiring (T3 independent) → Fix1 (release engine) + Fix2 (tick live) + Fix4 (status endpoint) [parallel] → Fix5 (owner payments dispatch) → Verify → Review → Commit+Push.

## Task 1. releaseEngine manual confirm rail + 4-bucket routing
Priority: HIGH
Maps to AC-1, AC-2, AC-6, AC-7

Changes to `src/lib/treasury/release-engine.ts`:
- Prepend rail select logic before initiatePayment(): if owner.countryCode==='MA' OR (currency==='MAD') OR accountNumber matches MA-RIB pattern (24 digits / `^00781\d{19}$`) → **manual rail**:
  - heldBalance decrement → NO (kept held until confirm).
  - settle status='processing' (manual pending).
  - connectorStatus='manual_attested_pending'.
  - metadata.rail = 'attijariwafa_mad_manual_operator_mobile'.
  - metadata.reason = 'owner mobile-app transfer required; attach MT103/WPS reference via confirmRelease'.
  - result: ok=false, status=PENDING_MANUAL_TRANSFER, needs_manual_proof reason + manual rail selector.
  - confirmRelease(externalRef) with length>=6 non-placeholder → find that OwnerSettlement, do held decrement + spendable increment + totalSent increment, mark status='completed', connectorStatus='manual_attested_finance'.
- Bucket routing selector (new getOwnerAccountForBucket(bucketCode, currency)):
  - salary_bucket → findUnique where accountNumberLast==='182' isActive=true country MA;
  - debt_repayment → where accountNumberLast==='372' (Attijari Carnet per owner profile).
  - sovereign_reserves: if currency in ('USD','EUR') → Banking Circle primary; else fallback MA-RIB RIB 182 Salary account.
  - runtime_operations: Banking Circle USD primary; MA-RIB RIB 182 if not found.
  - default: OWNER_IBAN env or findUnique(accountNumberLast='182') as last resort.
- Idempotency: confirmRelease(externalRef) — find First OwnerSettlement where referenceId=ref; if exists → return result + idempotentReplay:true (no DB writes). Append auditLedger on new transition only.
- ReleaseRequest.ownerAccountId = selected account from routing, overriding if the provided ownerAccountId does NOT match the bucket-correct destination. This prevents accidental RIB mismatch by any future caller.

TRs (task-local rules/rubrics):
- TR1.1 (rule): MAD amount 1234.56 with RIB 372 → result.status == PENDING_MANUAL_TRANSFER.
- TR1.2 (rule): confirmRelease(ref=WPS-XXXXXX length 10) on the same → returns completed settlement, held decremented.
- TR1.3 (rule): bucketCode=salary_bucket release → route to accountNumberLast='182'; debt_repayment→'372'; 4 buckets 4 routes tested.
- TR1.4 (rule): confirmRelease(ref=<placeholder>) → fail-closed (rejected + not completed + held not touched).

## Task 2. Payout Tick per-destination-type live gates
Priority: HIGH
Maps to AC-3, AC-8

Changes to `src/app/api/payouts/tick/route.ts`:
- buildProviderConfig → split: buildPayPalLiveConfig(), buildBankLiveConfig(), buildCryptoLiveConfig().
- Each config returns {live:boolean, liveConfig:Record}.
- buildProviders() → returns live provider per-destination type using correct per-type config.
- If no config for type → fallback to dry-run. Never tie bank/crypto liveness to PPP2 flags.

TRs:
- TR2.1 (rule): Env set = SWARM_LIVE=true, BANK_RAIL_API_KEY=a, BANK_RAIL_ACCOUNT_ID=b → buildProviders('bank') returns BankWireProvider live=true.
- TR2.2 (rule): Env = SWARM_LIVE=true CRYPTO flags set, no BANK flags → crypto live, bank dry-run.
- TR2.3 (rule): PayPal PPP2 false + BANK set → bank live; old behavior (live tied to PPP2 only) no longer possible — test explicitly.

## Task 3. Payout secrets in vault + sync
Priority: HIGH
Maps to AC-4

Files:
- .github/vault-config/audience.json: append 10 keys:
  - PAYOUT_TICK_SECRET, OPS_API_SECRET, CRON_SECRET, SWARM_LIVE, PAYPAL_PPP2_APPROVED, PAYPAL_PPP2_ENABLE_SEND, BANK_RAIL_API_KEY, BANK_RAIL_ACCOUNT_ID, CRYPTO_SIGNING_POLICY, CRYPTO_HOT_WALLET_REF.
- src/app/api/webhooks/github-secrets/route.ts: KNOWN_SECRET_CONNECTORS add 10 entries:
  - paypal connector: SWARM_LIVE, PAYPAL_PPP2_APPROVED, PAYPAL_PPP2_ENABLE_SEND (already has paypal client+secret+webhook id)
  - bank connector: BANK_RAIL_API_KEY, BANK_RAIL_ACCOUNT_ID, SWARM_LIVE
  - crypto connector: CRYPTO_SIGNING_POLICY, CRYPTO_HOT_WALLET_REF, SWARM_LIVE
  - ops / tick connector: PAYOUT_TICK_SECRET, OPS_API_SECRET, CRON_SECRET, SWARM_LIVE → activateKey('ops') or keep with deploy 'ops' connector id? → create connector id = 'tick_ops'.
- connector-self-test.ts providers: add tick_ops (required PAYOUT_TICK_SECRET+OPS_API_SECRET+CRON_SECRET) + add paypal (SWARM_LIVE + PPP2 2 flags).

TRs:
- TR3.1 (rule): audience.json has all 10 new keys total keys=70.
- TR3.2 (rule): webhook KNOWN_SECRET_CONNECTORS maps all 10 new keys to 4 connectors.
- TR3.3 (rule): JSON/YAML parse OK; tsc 0 errors.

## Task 4. GET /api/payouts/status
Priority: MEDIUM
Maps to AC-5, AC-9

New file `src/app/api/payouts/status/route.ts`:
- GET 200 JSON {ok:true, summary: {...}, byRail:{}, byBucket:{salary,debt,sovereign,runtime,procurement}, byOwnerAccount: [{id,label,accountType,last4,currency,pendingCount,pendingAmount,completed24h,completedAmount24h,railReady}], ownerPayoutSummary:{stuckCount,pendingCount,processingCount,completedCount,totalAmountCompleted24h}}.
- Counts come from: payoutBatch + payoutItem statuses, ownerPayment.status in (stuck_in_transition = stuck; pending/processing = pending), treasury status (from getOwnerLedgerStatus), byRail = paymentMethod in payout items, byBucket = FundBucket group.

TRs:
- TR4.1 (rule): GET /api/payouts/status → 200, ok=true, stuckCount field exists, byRail has 4 keys (paypal, bank_wire, crypto, manual_mad).
- TR4.2 (rule): populated / empty ownerAccounts still return array 6 long (seed list from owner-accounts seed).

## Task 5. Wire route dispatch in owner-payments POST
Priority: MEDIUM
Maps to AC-6

In `src/app/api/owner-payments/route.ts`:
- POST /api/owner-payments with item.status in ['pending','stuck_in_transition'] and a ribNumber matching MA RIB pattern → now dispatch via releaseOwnerFunds call with manual rail selector or PENDING_MANUAL_TRANSFER state + ownerPayment.status updated to processing + releaseResult.status saved; write destinationFingerprint = sha256(ribNumber).
- On item with existing destinationType=='external_bank' + ribNumber MA → wire to manual confirm rail; if SEPA/EUR IBAN + LIVE_BANK_API → wire PSD2.

TRs:
- TR5.1 (rule): POST 1 MA salary RIB item → ownerPayment transitions to processing; result includes manual_pending status.
- TR5.2 (rule): duplicate idempotent (same sourceTxRef) returns same record + idempotentReplay:true.

## Task 6. Verify & Tests
Priority: HIGH
- New test file `src/payout/__tests__/owner-payout.test.ts` with 8 tests covering TR1.1-TR1.4, TR2.1-TR2.3, TR4.1.
- `npm run typecheck` → 0 errors.
- `vitest run` → 188+ tests all pass.
- Status endpoint smoke test: `node -e "(await fetch('/api/payouts/status')).json()" → has stuckCount.

## Task 7. Review + Collective Memory + Commit+Push
Priority: MEDIUM
- write review.md with 9 ACs scored; 4 rubrics ≥4.
- append to CHANGELOG.md under next unreleased / 3.2.0 entry: 7 lines detailing all changes.
- update project_memory.md + today's topics.md (new session entry).
- git add, commit with conventional msg, push to origin HEAD:main.
