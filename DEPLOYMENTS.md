# Deployments & Live Endpoints

This is the canonical registry of live swarm/base44 deployments. The actual revenue / payout
machinery is deployed as Base44 apps (`*.base44.app`) fronted by `space-z.ai` public URLs,
plus the Vercel supply-chain front-end.

## 2026-09-07 — OWNER HANDS-FREE PAYOUT POLICY (supersedes the manual-approval contract)

**Owner directive:** "owner hands-free policy applies" — the per-payout manual-approval gate is REMOVED. Payouts run end-to-end automatically through the event-driven state machine. Guardrails stay fail-closed.

**Exactly ONE engine remains** (the earlier "driver coexistence contract" — autonomous tick + manual approval path — is superseded; `src/payout/dispatch.ts` + `src/payout/reconcile.ts` from commit cc3ad3d were RETIRED because their divergent settlement-booking key risked double-booked ledger lines):

- `src/payout/pipeline.ts` + `POST /api/payouts/tick` (x-tick-secret gated, fail-closed without `PAYOUT_TICK_SECRET`) — drives CREATED→ELIGIBLE→RESERVED→VALIDATED→READY→SUBMITTING→SUBMITTED→PROCESSING→COMPLETED→RECONCILED, including dispatch from READY. Bounded per call (`PAYOUT_TICK_LIMIT`, default 50).
- `scripts/payout-ops.ts` — thin ops window over the SAME engine: `status` / `tick [--limit N]` / `advance --id`. No divergent logic.

Fail-closed guardrails (unchanged): SWARM_LIVE + per-rail gates (PayPal: `PAYPAL_PPP2_APPROVED` + `PAYPAL_PPP2_ENABLE_SEND` + credentials) required for any real send — otherwise RETRYABLE_FAILURE, provably nothing sent. Caps: per-payout max, rolling-24h settled-per-currency, daily failed-submit throttle. UNKNOWN never re-submits (provider reconciliation or quarantine only). Settlement booked only on provider evidence, idempotent key `payout:<id>:SETTLED`, same transaction as COMPLETED→RECONCILED.

Commit: consolidation + retirement (Space-Z/SecretScan green, 115/115 tests, tsc clean).

**To make it run hourly (owner actions):** set `PAYOUT_TICK_SECRET` (and optionally `PAYOUT_TICK_LIMIT`) in the deployment env, then schedule `POST /api/payouts/tick` hourly (GitHub Actions step — my token lacks `workflow` scope, owner applies — or z.ai cron). Until SWARM_LIVE + rail credentials are enabled, the tick runs the full machine but every submit fails closed: no money can move by automation.

## Settlement-gap P2 — payout execution + reconciliation live (2026-09-07, verified)

Pushed to `main` as `cc3ad3d`; CI: **Space-Z green, Secret Scan green** (Vercel-token + multi-platform failures remain known-benign). 31/31 payout tests, tsc clean under repo `strict:false`.

Payouts now run **beyond RESERVED to fully executed** — the gap where the P0/P1 state machine and provider seam existed but nothing drove `RESERVED -> ... -> RECONCILED` is closed:

- `src/payout/dispatch.ts` — the ONLY READY→submission path. `preparePayout` (RESERVED→VALIDATED→READY) requires a named manual approver BEFORE any transition (fail-closed; holds/fingerprint/amount pre-flight). `dispatchPayout` (READY→SUBMITTING→SUBMITTED) records provider refs atomically (optimistic version + PayoutEvent in one transaction); live-gate miss = provably nothing sent → RETRYABLE_FAILURE; ambiguous outcome → UNKNOWN + RECONCILIATION_REQUIRED, never retried by construction; in-flight payouts are refused re-dispatch (idempotent).
- `src/payout/reconcile.ts` — the ONLY SUBMITTED→RECONCILED path. Advances strictly on provider-reported truth: SUBMITTED→PROCESSING→COMPLETED, UNKNOWN resolves only to COMPLETED or QUARANTINED (never READY), unpollable payouts flagged for provider-side history pull. **Only reconciliation books settlement**: COMPLETED books the idempotent `PAYOUT_SETTLED` RevenueLedgerEntry (`payout-settled:<id>` key, crash-safe), then → RECONCILED.
- `scripts/payout-ops.ts` — MANUAL lifecycle CLI: `status` / `prepare --id --by --reason` / `dispatch --id` / `reconcile --id|--all`. No daemon, no cron, no auto-approval. Graceful skip without DATABASE_URL.

Owner runbook (per payout): `prepare` (your approval signature) → `dispatch` (fail-closed live gate; SWARM_LIVE stays off until you flip it) → `reconcile --all` (books provider truth). The state machine guarantees: exactly-once submission (idempotencyKey + READY-only dispatch), no blind retries (UNKNOWN never loops to READY), settlement only on provider evidence.

**Still gated/P3:** live provider REST wiring (PayPal/Bank/Crypto submitLive/fetchStatusLive bodies — currently fail-closed stubs), provider-side history API pulls, prisma `db push` for Payout models at next deploy.

## External settlement audit response (2026-09-07) — cron chain removed, mirror cleanup v2

An external audit of the PUBLIC MIRROR (www-realworldcerts-com, master) flagged five P0-stop behaviors. Verdict per repo:

**This repo (younestsouli2019-bot, main): already compliant on 4 of 5.** The mirror's dangerous files (auto_settlement_daemon.js, real_settlement_backend.js, live_execution_flow.js) never existed here. The audit's "missing" items (payout state machine, UNKNOWN state, provider reconciliation-before-retry, idempotency, immutable ledger) were built here 2026-09-07 as P0/P1 (commits 4ade092 → 8bbdc15). What it DID catch: our dormant cron-approval chain — **removed in 8bbdc15**:
- `scripts/scheduler.js` (hourly node-cron) + `scripts/approve-paypal.js` / `approve-crypto.js` / `approve-bankwire.js` — auto-approved ALL PENDING_APPROVAL revenue events via gateways and marked them PAID_OUT with no state machine, idempotency, reconciliation, or owner confirmation. Nothing referenced the chain (verified: no workflow/daemon/package.json/doc), it was dead code one SWARM_LIVE flip from becoming an ungated payout engine. Deleted per owner directive (reject cron-based auto-payouts).
- Remaining executor scripts (owner-payout-paypal.mjs, payout-paypal-once.mjs, execute-crypto-withdraw.mjs, etc.) are MANUAL-dispatch only (owner-crypto-withdraw.yml / owner-payout.yml: `environment: payouts` human approval + I8 capability gates + safe==1 guardrails) — compliant with "manual approval required for all payouts".

**Mirror (www-realworldcerts-com, master): carries the full dangerous lineage at HEAD.** Verified live on the public repo: all three engine files exist; `real_settlement_backend.js` contains a hard-coded owner PayPal email + EVM wallet address in source; `live_execution_flow.js` a hard-coded owner email; plus the previously-flagged 39 settlement artifacts and RIB in SNAPSHOT_PUBLIC. It also lacks all P0/P1 hardening (95-commit diverged history). **Cleanup packaged as `apply-mirror-cleanup-v2.sh`** (supersedes v1): applies the v1 artifact-removal commit, then deletes the three engine files with a full audit-trail commit message; flow verified end-to-end on a fresh clone (0 tracked settlement files, 0 engine files). Blocker unchanged: agent token blocked by org OAuth App access restrictions — run the one-shot script from an org-authorized account, or allowlist the app in org Third-Party Access settings. History rewrite/privatization still the owner decision.

## Settlement-gap P1 — PayoutProvider seam + watchdog tick (2026-09-07, verified)

Pushed to `main` as `af181d0`; CI: **Space-Z green, Secret Scan green** (Vercel-token + multi-platform failures remain known-benign). 15 unit tests, tsc clean.

- `src/payout/provider.ts` — the ONLY seam between payout execution and external rails (PayPal / bank-wire / crypto). Invariants enforced in code: fingerprint-only destinations (raw IBAN/email/account numbers never cross the seam), fail-closed live gate (`LivePathUnavailableError` unless SWARM_LIVE + complete config), deterministic idempotent dry-run, and dry-run `fetchStatus` returns `UNKNOWN` forever — a dry run can never masquerade as settlement evidence. Live REST wiring lands with the gated P2 dispatch (PPP2 approval + manual fail-closed approval).
- `src/payout/prisma-sources.ts` — read-only Prisma adapter feeding the Treasury watchdog: unreconciled payouts (`SUBMITTED`/`PROCESSING`/`UNKNOWN`, not `RECONCILED`), active holds, owner ledger. Legacy ledger rows map conservatively (`DEBIT+SETTLED → PAYOUT_SETTLED`, `DEBIT+AUTHORIZED → PAYOUT_RESERVED`, else `ADJUSTMENT`); payout-domain writers stamp `metadata.ledgerType` explicitly. Illegal legacy hold reasons coerce to `HELD_POLICY_REVIEW`.
- `scripts/run-watchdogs.ts` — the settlement watchdog tick. **Diagnose-only: zero mutations, zero money movement.** Graceful skip without `DATABASE_URL`. Counts-only stdout (public CI logs carry no ids/amounts); detailed findings go to `reports/watchdog/` (gitignored, never committed).
- Scheduler wiring: the one-step addition to the `autonomous-tick` job is prepared as `scheduler-watchdog-step-20260907.patch` — the agent PAT lacks `workflow` scope so GitHub rejects pushes touching `.github/workflows/*` (same limitation as previous sessions; a regenerated PAT with workflow scope fixes it permanently). The tick can also be run manually: `npx tsx ./scripts/run-watchdogs.ts`.

**P2 (next):** live provider REST wiring behind the gated dispatch, provider-side reconciliation pulls (PayPal history API), prisma `db push` for the Payout models at next deploy.

## Settlement-gap P0 — durable payout state machine (2026-09-07, verified)

Structural fix for the settlement gap (revenue → entitlement → payout instruction → external settlement → reconciliation had no durable owner between instruction and settlement). Implemented and pushed to `main` as `4ade092` + `81b416c`; CI: **Space-Z green, Secret Scan green** (Vercel-token + multi-platform failures remain known-benign).

**New payout domain (money-movement-free by construction):**
- `Payout` / `PayoutEvent` / `PayoutHold` Prisma models — immutable payout ledger: unique `idempotencyKey`, `provider`/`providerRequestId`/`providerTransactionId`, `reconciliationStatus` (`PENDING | EVIDENCE_PENDING | RECONCILIATION_REQUIRED | RECONCILED | QUARANTINED`), optimistic `version`. Additive — run `prisma db push`/migration at next deploy.
- `src/payout/state-machine.ts` — closed transition table; `UNKNOWN` resolves ONLY via provider reconciliation into `COMPLETED`/`QUARANTINED` (no `UNKNOWN → SUBMITTING` edge exists — blind retry is structurally impossible); retries re-enter through full validation.
- `src/payout/ledger.ts` — balances DERIVED from ledger entries (`available = credits − reservations − settled`); mutable `heldBalance`/`spendableBalance` buckets demoted from authoritative.
- `src/payout/eligibility.ts` — every hold has `holdReason` + `nextReviewAt` + optional expiry; "held forever" impossible.
- `src/treasury/watchdog.ts` + `src/recon/watchdog.ts` — diagnose-only watchdogs (stale holds, unreconciled payouts, UNKNOWN ops, evidence gaps, `MATCHED/MISSING_PROVIDER/MISSING_INTERNAL/AMOUNT_MISMATCH/CURRENCY_MISMATCH/DUPLICATE/EVIDENCE_PENDING`).
- `src/emit-revenue-events.mjs` — `buildLiveProofBase` SWARM_LIVE default `true → false` (proofs must never overstate live mode).
- `exports/recon/AUDIT_L2_REPORT.json` — machine-readable, sanitized audit (PayPal REST history gap 2026-08-26→28; `financial_execution_allowed=false`).
- `docs/SETTLEMENT_STATE_MACHINE.md` — full architecture + P0/P1/P2 rollout. **No cron→releaseOwnerFunds loop exists.** P2 dispatch stays gated (SWARM_LIVE=false default, PPP2 approval+send, destination validation, bounded batches, manual approval fail-closed).

**Security (P0) — payment artifacts OUT of Git (both repos are PUBLIC):**
- `younestsouli2019-bot` repo: 10 `settlements/paypal/*` artifacts untracked + gitignored; private backup retained (owner-held).
- `www-realworldcerts-com` mirror: 39 raw artifacts confirmed at HEAD (crypto withdrawal addresses, PayPal instructions with account-like recipient IDs, bank RIB in SNAPSHOT_PUBLIC). **Agent token is blocked by the org's OAuth App access restrictions — the cleanup commit (artifact removal + snapshot sanitization + gitignore) is prepared as a patch and needs an org-authorized push.** Applies to `master` of `www-realworldcerts-com/Nouveau-dossier-3-`.
- **Remaining exposure — owner decision required:** Git HISTORY of both public repos still contains the artifacts. Options: (a) privatize the repos (instant, keeps history), (b) history rewrite via filter-repo + force-push (disruptive: breaks clones/z.ai pulls/mirror sync), (c) accept history exposure. Recommend (a) for the mirror if its public posture isn't deliberate.

## Payout-view coordination — AgentFlow Base44 app ⇄ live command center (2026-09-06, verified)

`FinancialDashboard.jsx` in the AgentFlow AI Base44 app (app id 6888ac155ebf84dd9855ea98, 25-page command center) was frozen: its PayoutBatch entity held 5 stale July-2026 records and PayoutItem was empty, while the live command center backend (b1fx661hzse0-d.space-z.ai) served fresh payout state (8 batches BATCH-2000..2007, 38 items, USD; 6 success / 1 draft / 1 denied-by-guardrail batches; 23 success / 11 approved / 4 failed items).

**Architecture decision (backend functions are NOT enabled in the AgentFlow app, and cross-app entity writes are blocked from chat):** the payouts view now fetches live, client-side, directly from `https://b1fx661hzse0-d.space-z.ai/api/payouts` — CORS on that API reflects arbitrary origins (verified: `Access-Control-Allow-Origin` echoes the Base44 app origin, GET 200). Single source of truth, zero sync drift, no duplicated data.

- Base44 app: 3 builder edits (2026-09-06) — payouts view added to FinancialDashboard.jsx, then entity-binding removed in favor of the live fetch with refresh/retry + fail-visible error state. App builds `ready`, no errors. Verify at the editor preview: https://app.base44.com/apps/6888ac155ebf84dd9855ea98/editor/preview
- The app is unpublished (public view gated) — publishing is an owner decision, not done.
- **Legacy data review (pending):** the 5 frozen July PayoutBatch records were left untouched per instructions — notably `BATCH_RECOVERY_BANK_WIRE_178488017{7,81}_PAYPAL_BRIDGE_00{1..4}` at $37,313.25 ×4 in perpetual `processing`, which match the fabricated-data era cleaned up in 050646c. Recommend deleting or marking them superseded after owner confirmation.
- z.ai/ZCode side unchanged: the ZCode workspace still needs the one-time z.ai login to sync the same payouts view into the ZCode front and to reconnect git credentials on `t1trn6kunnv1-d`.

## Unfreeze sweep (2026-09-06, read-only external probes — WebFetch only, shell down)

Autonomous unfreeze sweep result: **2 of 4 surfaces frozen, and both are z.ai-dashboard-gated (owner OAuth), not fixable from the repo.**

| Surface | Status 2026-09-06 | Evidence |
|---------|-------------------|----------|
| AgentFlow AICC (`b1fx661hzse0-d.space-z.ai`) | ✅ LIVE / not frozen | Shell renders ("AgentFlow AI · Command Center", INITIALIZING + "Loading live data…" to anonymous fetch — expected); Base44 backend `agent-flow-ai-9855ea98.base44.app/api` serves the app shell + 28-route nav. Nothing to unfreeze. |
| Vercel (`supply-chain-swarm.vercel.app`) | ✅ LIVE | `/api/healthz` → `{"ok":true,…,"version":"3.0.0","status":"healthy"}`. |
| Supply Chain Main (`t1trn6kunnv1-d.space-z.ai`) | ⚠️ SERVING but rebuild STILL FROZEN (unchanged from 09-05) | `/` 200 with the full Operations Control Center UI, but `/api/healthz` → 404 → still the pre-2026-09-02 stale artifact. The workspace's `git pull origin main` credentials remain dead; dashboard-documented `/api/dashboard` responds 200. **Unfreeze = owner reconnects GitHub repo in the z.ai dashboard, then redeploy** (per 09-05 findings — the chat.z.ai/auth login session is still the gate). |
| HIT Swarm (`x1he4604ap01-deploy.space-z.ai`) | ❌ STILL DOWN — 502 (unchanged since Sept 1) | Empty-body 502 from Alibaba FC gateway. **Unfreeze = Space-Z dashboard redeploy of instance `x1he4604ap01-d`** (no SPACEZ_TOKEN in-repo; dashboard action only). After it is up: Autopilot ON → Run Tick. |
| Supabase secure-cloud mirror · git mirrors · doomsday-vault | ⛔ FROZEN — not autonomously actionable | Require live secrets (`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`MIRROR_SUPABASE_BUCKET`, `GITLAB_MIRROR_REPO`/`GITLAB_PAT`, `DOOMSDAY_ARCHIVE_PASSPHRASE`) that are intentionally not in-repo/env-shell, plus a working shell (this session: Git Bash fork failure active). Blocked at two independent layers. |

Data-quality note on the stale Supply Chain Main build: its public `/api/dashboard` still shows the old pre-cleanup ledger narrative ($3,722.90 "revenue", HIT Marketplace $2,622.50, batches PB-2025-001/002 auto-approved by "Swarm Autopilot") with `batchedAt` (2025-07) PREDATING `createdAt` (2026-08-28) and all proof/integrity hashes `null` — the known UNVERIFIED/fabricated-era data. Nothing booked; treat that instance's numbers as stale fiction until the rebuild lands and the post-cleanup data is confirmed.

## Sync sweep (2026-09-06, later — WebFetch only, shell still down)

Operator-requested synchronize/coordinate pass over z.ai (Space-Z) + Base44 surfaces. Result: **one regression, everything else unchanged.**

| Surface | Status this sweep | Δ vs earlier 09-06 sweep |
|---------|-------------------|--------------------------|
| AgentFlow AICC (`b1fx661hzse0-d.space-z.ai`) | ✅ LIVE — "AgentFlow AICC · Command Center" shell renders, Truth-Only UI ON, INITIALIZING/"Loading live data…", nav incl. Fusion Engine / Payout Control / Owner Accounts; footer `SWARM_LIVE=true · NO_PLATFORM_WALLET=true` | unchanged |
| Base44 backend (`agent-flow-ai-9855ea98.base44.app/api`) | ✅ reachable — serves the app HTML index + route nav (still the keyless page-name enumeration leak: `/APIDocumentation`, `/AgentChat`, `/PayoutControl`, `/SecureRepository`, …) | unchanged |
| Supply Chain Main (`t1trn6kunnv1-d.space-z.ai`) | ❌ **NOW 502 on `/` AND `/api/dashboard`** | **REGRESSED** — this morning it still served the stale pre-09-02 artifact (200); the instance has now gone down entirely. This is a further expiry-recycle step, not a code fault (the repo builds green; the workspace's git-pull credentials were already dead). **Unfreeze = owner reconnects GitHub repo in the z.ai dashboard + redeploy** — same dashboard gate as before; the stale-artifact data-quality warning below is now moot while it's down. |
| HIT Swarm (`x1he4604ap01-deploy.space-z.ai`) | ❌ 502 (empty Alibaba FC gateway body) | unchanged (down since Sept 1) |
| Vercel (`supply-chain-swarm.vercel.app`) | ✅ `/api/healthz` → `{"ok":true,"version":"3.0.0","status":"healthy"}` | unchanged |

Coordination summary: 2 of 5 surfaces down at the platform layer, both unfreezable ONLY via the z.ai dashboard (owner OAuth reconnect / Space-Z redeploy) — unchanged gate. No secret-bearing sync action is possible or attempted from the repo (live secrets intentionally not in-repo; shell down). "Fusion Engine" appears in the live AICC nav but has no repo-side counterpart verified this session — treat platform-side features as unverified against the repo's truth records until data is audited with a key (key-out-of-transcript rule).

## Unfreeze sweep (2026-09-06, read-only external probes — WebFetch only, shell down)

Autonomous unfreeze sweep result: **2 of 4 surfaces frozen, and both are z.ai-dashboard-gated (owner OAuth), not fixable from the repo.**

| Surface | Status 2026-09-06 | Evidence |
|---------|-------------------|----------|
| AgentFlow AICC (`b1fx661hzse0-d.space-z.ai`) | ✅ LIVE / not frozen | Shell renders ("AgentFlow AI · Command Center", INITIALIZING + "Loading live data…" to anonymous fetch — expected); Base44 backend `agent-flow-ai-9855ea98.base44.app/api` serves the app shell + 28-route nav. Nothing to unfreeze. |
| Vercel (`supply-chain-swarm.vercel.app`) | ✅ LIVE | `/api/healthz` → `{"ok":true,…,"version":"3.0.0","status":"healthy"}`. |
| Supply Chain Main (`t1trn6kunnv1-d.space-z.ai`) | ⚠️ SERVING but rebuild STILL FROZEN (unchanged from 09-05) | `/` 200 with the full Operations Control Center UI, but `/api/healthz` → 404 → still the pre-2026-09-02 stale artifact. The workspace's `git pull origin main` credentials remain dead; dashboard-documented `/api/dashboard` responds 200. **Unfreeze = owner reconnects GitHub repo in the z.ai dashboard, then redeploy** (per 09-05 findings — the chat.z.ai/auth login session is still the gate). |
| HIT Swarm (`x1he4604ap01-deploy.space-z.ai`) | ❌ STILL DOWN — 502 (unchanged since Sept 1) | Empty-body 502 from Alibaba FC gateway. **Unfreeze = Space-Z dashboard redeploy of instance `x1he4604ap01-d`** (no SPACEZ_TOKEN in-repo; dashboard action only). After it is up: Autopilot ON → Run Tick. |
| Supabase secure-cloud mirror · git mirrors · doomsday-vault | ⛔ FROZEN — not autonomously actionable | Require live secrets (`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`MIRROR_SUPABASE_BUCKET`, `GITLAB_MIRROR_REPO`/`GITLAB_PAT`, `DOOMSDAY_ARCHIVE_PASSPHRASE`) that are intentionally not in-repo/env-shell, plus a working shell (this session: Git Bash fork failure active). Blocked at two independent layers. |

Data-quality note on the stale Supply Chain Main build: its public `/api/dashboard` still shows the old pre-cleanup ledger narrative ($3,722.90 "revenue", HIT Marketplace $2,622.50, batches PB-2025-001/002 auto-approved by "Swarm Autopilot") with `batchedAt` (2025-07) PREDATING `createdAt` (2026-08-28) and all proof/integrity hashes `null` — the known UNVERIFIED/fabricated-era data. Nothing booked; treat that instance's numbers as stale fiction until the rebuild lands and the post-cleanup data is confirmed.

## Deploy-mechanism findings (2026-09-05 ~19:00, verified)

### t1trn6kunnv1-d (Supply Chain Main) — build is STALE, auto-rebuild BROKEN at platform layer

The z.ai platform intercepts `/api/webhook/deploy` with its own deploy orchestrator (GET returns its deploy log; the app route schema on `main` was never deployed). Findings from the platform deploy log:

- Every rebuild attempt fails instantly with **`Command failed: git pull origin main`** (duration 4–16 ms — auth failure, not a code issue). The z.ai workspace lost its GitHub credentials in the Sept 1 expiry-recycle; the repo is private, so unauthenticated pulls cannot work.
- Fingerprint of the live build: `/api/healthz` → 404 (route added to `main` on 2026-09-02), `/api/bybit|revenue|swarm` → 404, while `/api/payout-batches` + `/api/settlements` → 200. The instance serves a **pre-2026-09-02 build** — working but stale.
- GitHub push deliveries are accepted by the platform hook ("HTTP OK"), but the resulting rebuilds all die at `git pull`. `totalDeploys: 0`.
- **Signed-redelivery verification (2026-09-05 18:12, conclusive):** a properly-signed GitHub push redelivery (delivery id 3841055982457192448, commit `e0548b4`) was accepted by the platform hook, which parsed the commit correctly and created deploy record `DEP-…` — then died at the same wall: `git pull origin main` failed in 8 ms. The platform's webhook processing, signature handling, and deploy tracking are all healthy; **only the workspace's git pull credentials are dead**. Five deploy attempts today (signed pushes + manual nudges) show the identical instant-failure signature, `totalDeploys: 0`.
- **Remediation (owner, dashboard):** in the z.ai dashboard for `t1trn6kunnv1-d`, reconnect the GitHub repo (or use "Fetch Latest Commit") so the workspace regains pull credentials, then redeploy. `main` at `e0548b4` builds green (fresh Space-Z CI run 2026-09-05: 57/57 pages).
- **Remediation in progress (2026-09-05 19:35):** a browser session is standing by at `chat.z.ai/auth` awaiting the owner's one-time z.ai login (Google / Email / GitHub — GitHub preferred, it re-grants repo access in the same flow). After login, the plan is: reconnect the GitHub repo on `t1trn6kunnv1-d`, redeploy it, then redeploy HIT Swarm `x1he4604ap01-deploy` (same recycle damage), and verify both serve the latest green build.

### b1fx661hzse0-d (AgentFlow AICC) — already CURRENT, nothing to update

The space-z front proxies the Base44 app `agent-flow-ai-9855ea98.base44.app` (Base44 app status: ready, HTTP 200, title "AgentFlow AI · Command Center"). Base44 apps deploy on edit; no GitHub-repo build exists for this instance, so the repo's Prisma/Next fixes do not apply to it. No action needed.

## Status Snapshot (2026-09-05) — Space-Z Main recovered; Binance rail live

### Verified live status (external probes, 2026-09-05 ~18:00 UTC+1)

| Surface | Status | Notes |
|---------|--------|-------|
| Vercel (`supply-chain-swarm.vercel.app`) | ✅ LIVE on latest commit (b9e8952) | `/api/healthz` 200 · `/api/dashboard` 200 · `/api/owner-accounts` 200 · `/api/procurement` 200 |
| Space-Z Supply Chain Main (`t1trn6kunnv1-d.space-z.ai`) | ✅ **RECOVERED** (was 502 since Sept 1) | `/` 200 · `/api/dashboard` 200 · `/api/owner-accounts` 200 · `/api/webhook/deploy` 200. Deploy webhook accepting GitHub push deliveries again (HTTP OK, 2026-09-05). Note: `/api/healthz` 404s on this instance — use `/api/dashboard` as the health probe. |
| Space-Z HIT Swarm (`x1he4604ap01-deploy.space-z.ai`) | ❌ STILL DOWN — Z.ai expiry-recycle | Empty-body 502 from Alibaba FC gateway (re-probed 3x). Its `/api/webhooks/github-secrets` hook rejects deliveries with 401. **Redeploy via Space-Z dashboard** (still no SPACEZ_TOKEN in-repo). |
| Space-Z AgentFlow AICC (`b1fx661hzse0-d.space-z.ai`) | ✅ LIVE | App shell renders (200). |
| Space-Z CI build (b9e8952) | ✅ GREEN | `Deploy to Space-Z` workflow success on latest commit. |
| Binance rail | ✅ **LIVE** | New API key accepted, withdrawals enabled (commit `6b8326a`). Funding gate now reports a single actionable blocker. |

### New machinery merged Sept 2–5 (16 commits through `b9e8952`)

Direct EVM + TON wallet rails (exchange bypass) · Binance direct rail · FinancialGuardian + orchestrator execution gate · machine-enforced financial policy (kill synthetic deficit) · I8 capability tokens + capability gate on EVM/TON send rails · safe mode + CI security gates · config-drift remediator · PO execution queue + fulfillment orchestrator · no-API settlement worklist · proof remediator + rail-funding monitor + delivery watchdog.

### CI failures found 2026-09-05 (with remediation)

| Workflow | Cause | Fix |
|----------|-------|-----|
| Swarm Tick | Job-level `NODE_ENV: production` makes `npm ci` omit devDependencies → `npx tsc` downloads the FAKE `tsc` registry package ("This is not the tsc command you are looking for") → exit 1 | ✅ FIXED this commit: `npm ci --include=dev` |
| Sync Secrets (Secure) | `APP_WEBHOOK_URL` / `APP_WEBHOOK_SECRET` repo Actions secrets missing | ⚠️ Operator must set both as repo Actions secrets |
| Autonomous Scheduler | Logs expired before capture (BlobNotFound) | 👁 Monitor next scheduled run |
| Deploy to Vercel (CI path) | Expired VERCEL_TOKEN (known) | Redundant — Vercel GitHub app deploys natively |
| Enterprise pipeline | Unconfigured platform mocks (known) | Non-blocking |

## Status Snapshot (2026-09-02) — Deployment Stability Restored

### Build & deploy chain — all patches live on `main` through `a3a2e99`

| Surface | Status | Notes |
|---------|--------|-------|
| Next.js 16 + Turbopack build (Space-Z CI) | ✅ GREEN 2026-09-02 | `build-verify` + `verify-secrets` + `trigger-deploy` all pass. Fixes: `turbopack: {}` + `serverExternalPackages` in next.config.mjs; BOM stripped from tsconfig.json (unblocked 164 alias-resolution errors); `react-is` added; Prisma 7 migration (mandatory `PrismaPg` driver adapter in `db.ts` + `phantom-quarantine.mjs`, truth-guards `$use` → `$extends` query extension, `datasourceUrl` removed). 57/57 static pages, exit 0. |
| Vercel (`supply-chain-swarm.vercel.app`) | ✅ LIVE on latest commit (a3a2e99) | GitHub-app native deploy; `/api/healthz` 200, `/api/dashboard` 200, `/api/owner-accounts` 200. |
| Space-Z instance `t1trn6kunnv1-d` | ❌ STILL DOWN — Z.ai expiry-recycle (platform-side) | 502 re-confirmed 2026-09-02. NOT a code fault — code builds green. **Redeploy via Space-Z dashboard** (no SPACEZ_TOKEN in-repo). |
| Space-Z instance `x1he4604ap01-deploy` (HIT Swarm) | ❌ STILL DOWN — Z.ai expiry-recycle (platform-side) | Same 502 signature. Redeploy via Space-Z dashboard. |
| `deploy-vercel.yml` CI path | ⚠️ redundant failure | Fails at "Pull Vercel Environment" (expired VERCEL_TOKEN). Harmless: Vercel GitHub app handles deploys natively. |

## Status Snapshot (2026-08-29)

### 🔐 OWNER RULING — "All roads lead to Mecca" (IMMUTABLE unless changed by OWNER)
Payout routing must resolve to **ANY available pre-set owner account** — the route with the **least fees**, the **easiest currency conversion** (or none), and the most **velocity headroom** under its per-rail limit. A missing or mismatched `OWNER_PAYOUT_RAIL` env var / currency MUST **NOT** abort disbursement; the resolver picks the best reachable pre-set account instead. Fail-closed **only** when zero usable routes exist. Implemented: `src/lib/payout-resolver.ts` (`resolveBestPayoutRoute`), wired into `AUTO_DISBURSE_PRESET_OWNER` (settlement-engine.ts), 2026-08-29. Changelog entry dated 2026-08-29.

| Component | Status | Notes |
|-----------|--------|-------|
| Next.js build (`npm run build`) | ✅ PASS | 3 static pages + 50+ API routes, exit 0 |
| Prisma schema | ✅ PASS | RevenueLedgerEntry ↔ LedgerAccount relation fixed. New `FundBucket` + `PayoutRoutingRule` models added; SQL migration in `prisma/migrations/20260829000000_add_treasury_buckets_routing/` (see § Treasury Buckets Migration below). |
| Truth Guards (TRUTH-001…006) | ✅ INSTALLED | Prisma middleware; 6 rules flag any completed-status record without external proof |
| Procurement ledger truth | ✅ RECONCILED 2026-08-29 | 175 items were `settled` with 0 delivery proof → demoted to honest `ordered`. 48 shipments `pending`, 0 tracking numbers, fabricated carrier labels nulled. Nothing asserted beyond what happened. |
| Carrier tracking (autonomous) | ✅ KEYLESS-DEFAULT | `src/lib/procurement/carrier-router.ts` autodetects local Morocco carriers (Poste Maroc / Amana / Aramex / DHL / FedEx / UPS / Chronopost) + public track-by-reference URLs with NO API key. Paid event data (`SHIP24_API_KEY`, `NINE_TRACKING_KEY`) optional; absent → `keylessCarrierRouter: true`, `trackingVerified=false` (never invents events). AutoPilot `carrier_resolve` phase runs it. |
| Carrier directory (2026-08-30) | ✅ EXPANDED | Web-confirmed track URLs for Cathedis (`cathedis.ma/tracker/index.php?track_number=`), Mylerz (`mylerz.net/track`), plus Quick Livraison / Skypostal / G4D / Tawssil / Coliaty / ASAP / Forcelog / Express Relais / Atlas as portal/API-identified carriers (`known:false` for URL, no invented endpoints). `autodetectCarrier(trackingNumber, platformHint)` disambiguates numeric collisions per platform (jumia/avito/superfood/shopify/iristech/marjane). |
| CRBT cash-return ledger | ✅ LIVE 2026-08-30 | `CashReturn` table + `cash-return.ts` state machine (`cash_collected → pending_remittance → in_transit → reconciled → returned`, `disputed` escape). Requires real external `proofRef` for reconciled/returned. AutoPilot `crbt_reconcile` phase opens rows on REAL-delivered COD only. Migration `20260830000200_add_cash_return_crbt` + fraud-guard PO fields `20260830000100_add_tracking_fraud_guard_fields` applied to Neon (via `prod:migrate`). |
| Fraud guard + verify closure | ✅ SHIPPED 2026-08-30 | `/api/carrier-tracking`, `/api/shipments/verify`, `/api/shipments/verify-all` now set `trackingVerified=true` ONLY on a real carrier `delivered` event + 3-point PO guard `VERIFIED_OK` (destination/weight/timeline). Blind flips and length≥8 heuristics removed. `payoutReleaseGate` in `payment-gateway-router.ts` adds COD 24h window + gateway-configured checks at settlement. |
| Prisma schema | ✅ PASS | RevenueLedgerEntry ↔ LedgerAccount relation fixed. New `FundBucket` + `PayoutRoutingRule` models added; SQL migration in `prisma/migrations/20260829000000_add_treasury_buckets_routing/` (see § Treasury Buckets Migration below). **`ownerInitiated` migration gap fixed**: `prisma/migrations/20260829000100_add_owner_initiated_scope/` created + applied to Neon (proc code now enforces prepaid-scope on prod). |
| Z.ai/Base44 Guardrails | ✅ CODE DONE | 2-tier fail-closed READ-ONLY execution gate + append-only fsync'd hash-chain journal + daemon journal seal. See § Z.ai / Base44 Guardrails below. |
| GLM-5.3 params (deployed apps call sites) | ✅ CODE DONE | `{ model: "glm-5.3", thinking: "enabled", reasoning_effort: "low" }` injected automatically in: `src/lib/dynamic-router.ts:callOpenRouter` + `swarm-ops-project/src/lib/free-models.ts:buildChatCompletionBody`. Phase-4 local option (vLLM/SGLang/OpenClaw) documented. |
| Vercel domain (`supply-chain-swarm.vercel.app`) | ✅ LIVE | Older 7-tab deployment (Accounts/Dashboard/Payments/Orders/Shipments/Procurement) — needs redeploy from latest code |
| Vercel project (`supply-chain-swarm-d6o8rq2qt-jonas-projects-ca14fe2e.vercel.app`) | 🔐 SSO-GATED | Redirects to Vercel login; must be redeployed via `deploy-vercel.yml` workflow with VERCEL_TOKEN |
| HIT Swarm (`x1he4604ap01-deploy.space-z.ai`) | ⚠️ DOWN / RECYCLED | ERR_INVALID_RESPONSE / 502 — consistent with Z.ai project expiry-recycle. Not a code fault. See **Z.ai Recycle Remediation** below. Redeploy via Space-Z dashboard (no SPACEZ_TOKEN in-repo). |
| AgentFlow AICC (`b1fx661hzse0-d.space-z.ai`) | ✅ **LIVE (re-verified 2026-09-01, external-path)** | Truth-Only UI: ON · SWARM_LIVE=true · NO_PLATFORM_WALLET=true · Owner payouts direct. Base44 backend (`agent-flow-ai-9855ea98.base44.app/api`) reachable. ⚠️ Keyless nav enumeration exposes payout page names — see roster note. |
| Supply Chain Main (`t1trn6kunnv1-d.space-z.ai`) | ❌ **DOWN (re-confirmed 2026-09-01, external-path)** | HTTP 502 Bad Gateway — status regression from ✅ LIVE. Same failure signature as the HIT Swarm recycle (ERR_INVALID_RESPONSE/502, Z.ai project expiry). Not a code fault. **P0 — redeploy via Space-Z dashboard** (no SPACEZ_TOKEN in-repo). |
| Procurement optimization engine | ✅ CODE READY | 5-phase dedup + local Morocco sourcing (70–88% price factors) + bulk discounts (5–15%) |
| Course media (realworldcerts.com) | 🛑 BLOCKED | 302/302 courses FAIL media contract. Missing: IMAGE_GEN_API_KEY, VIDEO_GEN provider key, ASSET_BASE_URL pub host |

## Primary deployment roster

### Space-Z deployments (Alibaba Cloud Function Compute)

| URL | App | Base44 API / Scope | Status 2026-08-29 | Priority |
|-----|-----|-----------|-------------------|----------|
| https://x1he4604ap01-deploy.space-z.ai/ | **HIT Swarm · Autonomous Revenue Engine** | agent-swarm.base44.app | ❌ **DOWN** (ERR_INVALID_RESPONSE). Last deployed July 27 d4da1e2. Never ran a tick. | **P0 — REDEPLOY NOW. Revenue cannot flow without this engine online.** |
| https://b1fx661hzse0-d.space-z.ai/ | **AgentFlow AI Command Center (AICC)** | https://agent-flow-ai-9855ea98.base44.app/api | ✅ LIVE (re-verified 2026-09-01 via external path — local-shell curl is a false negative: machine TLS egress is blocked; control test to github.com fails identically). Shell renders: Truth-Only UI: ON · NO_PLATFORM_WALLET=true · SWARM_LIVE=true · Owner payouts direct; Overview showed INITIALIZING/"Loading live data…" to an anonymous fetch (expected for a client-side app). Base44 backend reachable (serves app shell + 26+ page nav keyless). ⚠️ Note: unauthenticated page-name enumeration is possible ("Automated PayPal Transfers", "Payout Control", "Manual Wire Execution", … are visible in nav HTML without a key) — consider gating nav behind auth platform-side. | P1 |
| https://t1trn6kunnv1-d.space-z.ai/ | **Supply Chain Main · 21 tabs** | Procurement · Shipments · Payments · Tracking · Payouts · Swarm Sync · Vault · Audit · Learning · Crypto · Execution · Deploy · Resilience · Architecture · Base44 · Pipeline · Custodian · plus 7 base tabs. Deploy webhook at `/api/webhook/deploy`. | ❌ **DOWN (re-confirmed 2026-09-01 via external path)** — HTTP 502. Was ✅ LIVE. Z.ai expiry-recycle signature. **P0 — REDEPLOY via Space-Z dashboard.** | P0 |

### Vercel deployments (Next.js — source: this repo, main branch)

| URL | App | Scope | Status 2026-08-29 | Priority |
|-----|-----|-------|-------------------|----------|
| https://supply-chain-swarm.vercel.app/ | **Supply Chain · Public domain** | 7 base tabs: Accounts / Dashboard / Payments / Orders / Shipments / Procurement. Footer: "Supply Chain Management — Younes Tsouli CIN:A337773 · OWNER-initiated POs: pre-paid by Swarm · Recipients $0 out-of-pocket · Third-party POs: standard terms apply". | ✅ LIVE, OUTDATED (re-verified 2026-09-01). Still the 7-tab build (missing 14 tabs vs t1trn6kunnv1). Dashboard renders an EMPTY un-seeded state (all metrics $0/0, "No data yet") — not showing the live Neon ledger, and it exposes a public "Initialize Data" button that seeds SAMPLE data into the live-looking dashboard: flag before sharing. Trigger `deploy-vercel.yml` to update. | **P0 — UPDATE DEPLOYMENT.** |
| https://supply-chain-swarm-d6o8rq2qt-jonas-projects-ca14fe2e.vercel.app/ | Vercel internal project URL (team: jonas-projects-ca14fe2e) | Same app as `supply-chain-swarm.vercel.app` (project alias). | 🔐 SSO — redirects to Vercel login. Redeploy via CI with VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID secrets. | P1 |

## 3 Procurement Recipients (PO addresses — OWNER-initiated POs ONLY: ALL ITEMS PRE-PAID BY SWARM)

Sourced from `procurement.txt` in repo root. For OWNER-initiated POs every item ships pre-paid; recipients disburse $0.
For third-party / non-owner POs (`ownerInitiated=false`): standard commercial terms apply between the non-owner parties. Swarm does not disburse and no pre-paid guarantee is in effect.
Optimization engine (5-phase pipeline in `src/lib/procurement/optimization.ts`) re-routes import items to cheaper **Moroccan local suppliers** (70–88% factors) automatically on each run. Trigger via `POST /api/procurement/optimize`.

| # | Recipient Name | Delivery Address | Tel | Procurement categories (key items) | Local sourcing discount appied |
|---|----------------|------------------|-----|------------------------------------|--------------------------------|
| 1 | **Mrs Hind Tsouli** | Etage 2 JASMIN II, IMM H3, APPT 21, SIDI-YAHYA-ZAÏR, 12150, Morocco | 0602680629 | Samsung 43" UHD Smart TV (UA43U8000FUXM) · Samsung 2.0 Soundbar (HW-B400F/MV) · 1080P+720P dash cam (170° + night-vision + 24h parking mode + G-sensor) · 5-in-1 electric rotary cleaning brush (USB rechargeable) · High-pressure washer foam gun (2X spray + car/plant/cleaning/inflate) | Electrocity Morocco 88% · Home Decor Casablanca 75% · Local Electronics Bazaar 80% |
| 2 | **Mr Younes Tsouli** | Lot. Rita, LOT C, Immeuble B, Appartement 17, BOUZNIKA, Casablanca-Settat 13100, Morocco | — | 2× Dell Precision 3541 (4TB) · Winston Filter Soft ×20 · Panter Mignon ×5 · Panter Café Crème Original ×5 · Camel Yellow Soft Filters ×5 · Café Pur Arabica 1kg Bali ×3 · Mini-Bar « ELEXIA » RM004 (48×52×41 cm, 600 DH/1–2j) · Samsung 65" UHD Smart TV (1 250 DH) · Kit Pause Café Gold (1 700 DH HT, via integral-location.ma) · Mini-PC + monitor (value/performance) · Shop surveillance security cameras · Fresh Moroccan vegetables pack · 5 kg fresh fish pack minimum · Kricely trail shoes EU49 / US13 ×2 (yellow + camouflage) · Brandit M-65 Giant Jacket (Olive, 2XL) · Mil-Tec US Tactical Flight Jacket (Black, 2XL) · Kitchen anti-splash backsplash guards ×8 · Football fan sticker packs (54pc + 50pc + 50pc) · 4-in-1 wall-mounted creative storage (ashtray/trash can, non-drill, 4pc) ×2 · Creative Black ashtray ×1 · Camera accessory kits (4/5/15/25/30/55/75/95/110 pc) ×2 · Mini 2G dual-SIM backup phone (outdoor/cycling/elderly) · Compact folding pocket knife + keychain · 2× 3D ergonomic box openers · 3× marbled waterproof self-adhesive PVC wallpaper rolls (500×40 cm) · OnePlus 15 5G smartphone · Natural nitric-oxide boosters (superfood.ma) + diabetes pack · Crest 3D Whitestrips Professional Effects + Opalescence Go (dentist-grade peroxide) · Wholesale consumer electronics (Temu/AliExpress $10-or-less catalogue: mice, flash drives, solar banks, BT earbuds, USB-C cables, chargers, BT speakers, LED lamps, phone holders, smartwatch bands, USB hubs, cooling pads, IR thermometers, LED strips, rechargeable AA/AAA, mini fans, BT finders, laser pointers, UV sanitizers, foldable BT keyboards, screen magnifiers, digital scales, gimbals, LED readers, SSD enclosures, FM radios, phone cleaning kits, BT lav mics, dictaphones, cable organisers, FM transmitters, touchscreen gloves, BT car kits, kitchen timers, cable clips, travel power-strips, mini tripods + remotes, USB hand-warmers, airpod cases, hygrometers, RFID wallets, BT receivers — 50+ SKUs | Outdoor Gear Rabat 82% · Gift Shop Agdal 70% · Tech Souk Sidi Yaacoub 78% · SuperFood Local 88% · Parfumerie Agdal 85% · Local Electronics Bazaar 80% · Home Decor Casablanca 75% · Electrocity Morocco 88% · Plus qty-tier bulk discounts: 5% @5, 10% @10, 12% @15, 15% @20+ |
| 3 | **M Bachir Tsouli** | 45 Avenue Ibn Sina, Appartement 4, Agdal, Rabat, Morocco | — | Tablet CR 10.1" Android 16 2-in-1 GMS Tab · Paco Rabanne + Montblanc Legend perfumes · Premium stylish orthopaedic cane · Premium orthopaedic slippers · SuperFood.ma nitric-oxide production natural pack + diabetes pack | Medical Supply Rabat 82% · Parfumerie Agdal 85% · SuperFood Local 88% |

### Pre-paid guarantee
Footer on every deployed page reads: **"Supply Chain Management — Younes Tsouli CIN:A337773 · OWNER-initiated POs: pre-paid by Swarm · Recipients $0 out-of-pocket · Third-party POs: standard terms apply"**. This is enforced by `page.tsx` layout and cannot be overridden per-PO in the UI for OWNER-initiated rows.
Scope: The pre-paid guarantee applies **only** when `PurchaseOrder.ownerInitiated=true` (i.e. PO is created by the OWNER identity and destined to a recipient on the OWNER's list of designees — Hind, Younes, Bachir Tsouli). For third-party POs (`ownerInitiated=false`) standard commercial terms (COD / NET30 / NET60 / escrow) are allowed between the non-owner buyer and non-owner seller; Swarm does not disburse treasury funds and bears no payment risk for those POs. Rows are tagged at write-time via `enforcePrepaidPolicy()` in `src/lib/strict-enforcement/strict-procurement.ts`, and wet-run payout batches are skipped when `ownerInitiated=false`.

### Local supplier roster (Morocco)
Defined in `src/lib/procurement/optimization.ts` → `LOCAL_SUPPLIERS`. Price factor = final price as % of import baseline.

| Supplier | Pattern match | Price factor |
|----------|---------------|--------------|
| Local Electronics Bazaar | phone · cable · charger · usb · bluetooth · earbuds · speaker · led · holder · cooling | 0.80 (20% off) |
| Home Decor Casablanca | kitchen · sink · splash · wallpaper · ashtray · storage · cushion | 0.75 (25% off) |
| Outdoor Gear Rabat | shoes · jacket · pocket knife · trail · m-65 | 0.82 (18% off) |
| Gift Shop Agdal | sticker · football · creative | 0.70 (30% off) |
| Tech Souk Sidi Yaacoub | camera · accessories · 3d box | 0.78 (22% off) |
| SuperFood Local | food · fish · legumes · nac · whitening · whitestrip · opalescence · diabetes · nitric · natural | 0.88 (12% off) |
| Parfumerie Agdal | perfume · cologne · paco · rabanne | 0.85 (15% off) |
| Medical Supply Rabat | tablet · cane · slipper · orthopedic | 0.82 (18% off) |
| Electrocity Morocco | tv · samsung.*tv · television · soundbar · dash cam | 0.88 (12% off) |

## Owner Pre-Set Payout Accounts (5 rails)

Defined in `scripts/seed-pos.mjs` · all 5 routes are pre-seeded. Live destinations for auto-disbursement.

| Label | Rail | Currency | Recipient / Identifier | Primary | Purpose |
|-------|------|----------|------------------------|---------|---------|
| Banking Circle — Primary | bank_wire (Wise) | USD | Banking Circle S.A. · LU · Swift BCIRLULL · Account last-4 **646** | ✅ YES | settlements · vendor_payments |
| PayPal Business | paypal | USD | younestsouli2019@gmail.com (Business, MA) | — | general · settlements |
| USDC on Arbitrum | l2_crypto | USD | Wallet `0xA46225a984E2B2B5E5082E52AE8d8915A09fEfe7` · Chain 42161 · Token USDC | — | crypto_settlement · general |
| Payoneer — Supplier Payments | payoneer | USD | younestsouli2019@gmail.com | — | vendor_payments |
| Moroccan Bank — RIB 372 | bank_wire (Attijariwafa) | MAD | Attijariwafa · MA · Account last-4 **372** · RIB `007810000448500030594182` | — | salary · general |

### Fixed revenue split policy (from OwnerPaymentConfig)

| Bucket | Split % | Routing destination |
|--------|---------|---------------------|
| Salary (10% per prior profile × 4 =) | **40%** | Attijariwafa Bank — RIB 372 |
| Debt repayment | **40%** | Banking Circle Primary + PayPal Paydown (from settlement pool) |
| Revenue settlements | **30%** ← overrides prior when split conflicts are resolved at runtime | Banking Circle Primary (Wise) |
| Infrastructure | **20%** | Internal pool (server / APIs / hosting) |
| Emergency reserve | **10%** | Internal pool |

Note: The regulatory pipeline in `settlement-engine.ts` first deducts platform fee (OWNER_PAYOUT_FEE_BPS basis points) + chargeback reserve % + fraud-window hold hours, then routes the NET amount to the splits above. `autodisbursetopresetowner` is **true by default** per Owner Directive 2026-08-20. Per the **"All roads lead to Mecca"** ruling (2026-08-29), the exact rail is picked automatically by `src/lib/payout-resolver.ts`: least fee → easiest FX → most velocity headroom, DB-first (the table above) with `OWNER_PAYOUT_*` env preset fallback. Per-rail economics overridable via `OWNER_RAIL_<RAIL>_FEE_BPS|FX_BPS|CAP`.

### Wise rail readiness (from `reconciliation-flag-2026-08-28.json`)
- **`OWNER_WISE_API_TOKEN`**: verified valid (HTTP 200)
- Target Wise account: `73c0818e-6405-4645-abda-5046453370eb`
- Bank: Banking Circle, Luxembourg (LU7740800…)
- A genuine funded RevenueEvent is the missing input — rails are ready to disburse the moment real revenue is externally proved.

### Current honest payout balance
| Item | Value |
|------|-------|
| Base44 RevenueEvents `cancelled` | 85 / 158 |
| Outbound OwnerSettlements "completed" with externalRef=null (UNVERIFIED) | 17, sum $6 414.05 |
| Payout batches "processing" with duplicate proof (single ATTIJARI RIB ref reused for 4 distinct $37 313.25 batches → ~$149k claimed, 0 PayPal batch_id, 0 items) | 4 batches, FLAGGED UNVERIFIED by reconciliation |
| Authorizer ledger (`4000-Owner-Payable`) | $0.00 |

## RealWorldCerts course media (www.realworldcerts.com)

Audited 2026-08-27 by `scripts/rwc-course-media-audit.mjs` → `data/out/course-media-audit.json`.

| Metric | Value |
|--------|-------|
| Courses audited | 302 |
| Pass (media contract) | 0 |
| Fail | 302 (100%) |
| Publishing status | 🛑 BLOCKED (MEDIA_CONTRACT_FAILED) |
| Sample pass: hero_image required=1 | found=0 / 302 |
| Sample pass: thumbnail required=1 | found=0 / 302 |
| Sample pass: module_images required=3 | found=1 / 302 partial (33%) |
| Sample pass: diagrams required=2 | found=0 / 302 |
| Sample pass: trailer_video required=1 | found=0 / 302 |
| Sample pass: lesson_videos required=3 | found=0 / 302 |
| Sample pass: cheat_sheet required=1 | found=0 / 302 |

### Required secrets to unblock media generation
From `scripts/course-video-producer.mjs`:

| Env var | Where to get | Purpose |
|---------|-------------|---------|
| `IMAGE_GEN_API_KEY` | https://api.together.xyz/ (or any FLUX.1-schnell provider) | Hero/thumb/module/diagram/cheat image generation (FLUX.1-schnell default, 4 steps) |
| `VIDEO_GEN_API_KEY` **or** `REPLICATE_API_TOKEN` **or** `GOOGLE_AI_STUDIO_KEY` | Replicate / Google AI Studio / Runway | Course trailer & lesson videos. FAIL-CLOSED: `buildVideos()` throws explicitly if missing (no placeholder fabrication). |
| `ASSET_BASE_URL` **or** `ASSET_UPLOAD_URL` | R2 / S3 / Supabase Storage / Vercel Blob / CDN | Public host so the generated media URLs return HTTP 200. `storagePublish()` fail-closed if empty. |

### Scripts
| Script | Purpose |
|--------|---------|
| `scripts/course-video-producer.mjs --all` | Generate every missing asset (hero, thumb, module, diagram, cheat, trailer, lesson videos) per media contract. Writes to `data/generated/` + registry `data/out/course-asset-registry.json`. |
| `scripts/generate-course-posters.mjs` | SVG fallback banner posters. Does NOT require an API key. Produces `.svg` thumbnails (used as partial stopgap 1/3 for module_images). |
| `scripts/rwc-site-assets.mjs` | Inject SVG banner assets into `.vercel/output/static/assets/courses/` for the catalogue. |
| `scripts/rwc-course-media-audit.mjs` | Re-audit www.realworldcerts.com; writes updated `course-media-audit.json`. |
| `scripts/rwc-verify-site.mjs` | Smoke-check live RWC pages. |
| `scripts/rwc-checkout-pages.mjs` | Build RWC checkout static pages. |

## 5-Layer CORE-Protect

Still active on 48 critical files (vault scripts, CI workflows, daemons, settlement engine). Edits **require**:
1. `scripts/guard/apply-attrib-readonly.ps1 -Clear` (drop FS read-only bits)
2. Make edits
3. `scripts/guard/verify-core.ps1 -Init` (recompute SHA-256 manifest)
4. `scripts/guard/apply-attrib-readonly.ps1` (re-apply read-only + hook)
5. Git commit subject line begins **`[CORE-UPDATE]`** — else pre-commit + CI gates reject.

## Deployment workflows (GitHub Actions)

| Workflow | Trigger | Purpose | Required repo secrets |
|----------|---------|---------|-----------------------|
| `.github/workflows/deploy-vercel.yml` | push main · workflow_dispatch (prod / preview) | **NEW 2026-08-29.** Build + deploy to Vercel → `supply-chain-swarm.vercel.app`. Runs `/api/healthz` post-deploy verification. Posts procurement optimization checklist in summary. | `VERCEL_TOKEN` · `VERCEL_ORG_ID` · `VERCEL_PROJECT_ID` · `DATABASE_URL` |
| `.github/workflows/deploy-space-z.yml` | push main · workflow_dispatch (5 instance choices: main-app · hit-swarm · payout-recovery · trace-platform · agentflow) | Verify secrets, build Next.js, output artifact, print Space-Z redeploy instructions (Alibaba Cloud FC). | `BASE44_API_KEY` · `BASE44_SERVICE_TOKEN` · `DATABASE_URL` |
| `.github/workflows/deploy-pages.yml` | push main | GitHub Pages static output. | (default GITHUB_TOKEN) |

## What to do RIGHT NOW (P0 → P1 priority)

### P0: Unblock revenue and Vercel domain update
1. **Redeploy HIT Swarm (`x1he4604ap01`)** — see **Z.ai Recycle Remediation** below. Space-Z dashboard → instance x1he4604ap01-d → Redeploy / Fetch Latest Commit. Once back online: open dashboard → flip **Autopilot ON** OR click **Run tick**. Tick result must produce a RevenueEvent with external proof (not manual_attestation).
2. **Redeploy Vercel `supply-chain-swarm.vercel.app` from latest code.** Either (a) push main with VERCEL secrets set → `deploy-vercel.yml` runs, or (b) Vercel dashboard → Project → Deployments → "Redeploy" on latest. Post-deploy: verify 7 tabs render, hit `/api/healthz` → 200, click Dashboard → **Fix All Routing** (resolves the banner: "$0.00 trapped in Banking Circle / Operational Pool. Salary routing was never configured to reach owner RIB.").
3. In GitHub repo secrets, set: `VERCEL_TOKEN` · `VERCEL_ORG_ID` · `VERCEL_PROJECT_ID` so the new `deploy-vercel.yml` can deploy on every main push.

### Z.ai / Base44 project expiry & recycle remediation (template)

Applies to any `*.space-z.ai` / `*.base44.app` workspace that gets recycled mid-task (HIT Swarm `x1he4604ap01` is the current example).

1. **Architectural guardrails (implemented in code, `swarm-ops-project`):**
   - **Append-only event logging** — `src/lib/journal/append-only.ts`: every daemon tick writes a write-once, hash-chained (`prev → entryHash`) JSONL line to `data/swarm/journal/journal.jsonl` (gitignored, durable, survives mid-task disconnect). Wired into `src/app/api/swarm/daemon/route.ts` (journal entries for start / completed / failed). No update/delete API exists — the file is only ever opened with append flag.
   - **Execution isolation** — daemon refuses deploy/delivery writes when `PLAN_TRANSITION_MODE=1` (assessment-only run: reconcile + guard + fusion). This prevents a recycled workspace from writing into the base environment during an active plan-transition phase. Nothing must run against base env in write mode during transition.
2. **GLM-5.3 configuration (for Z.ai-hosted runtimes, set at redeploy):** GLM-5.3 must be initialized with `thinking: "enabled"` and `reasoning_effort: "low"` — starting it with thinking disabled causes an immediate API handshake failure:
   ```json
   { "model": "glm-5.3", "thinking": "enabled", "reasoning_effort": "low" }
   ```
   The local `src/lib/dynamic-router.ts` catalog routes via OpenRouter and does NOT host a GLM-5.3 entry; upgrade your recycled Z.ai projects to the GLM-5.3 runtime using the params above.
3. **Recycle the recovered workspace safely** — preflight: journal enabled; set `PLAN_TRANSITION_MODE=1`; run a tick; verify `reconcile` + guard + fusion produce output; THEN set `PLAN_TRANSITION_MODE=0` and let deploy/delivery resume.
4. **Fallback: local inference redundancy (Phase 4).** If a Z.ai/Base44 project cannot be recovered (expired credits / no dashboard access), the workspace can be reconstructed locally with open-weight models so revenue machinery never depends on a single vendor:
   - Pull `GLM-5.3-Flash` weights from HuggingFace;
   - Run offline via vLLM / SGLang (or OpenClaw for agent tooling);
   - Point the swarm's LLM router at the local endpoint (`OPENROUTER_BASE` override or a `local://` model entry);
   - Data governance shifts back to private bare-metal, eliminating project-expiry risk.

### P1: Procurement + Payouts + Course Media
4. **Seed 3 recipients into the DB if not present.** Run `npm run db:seed-pos` → seeds 8 POs, 5 suppliers, 5 owner accounts, 4 split configs, 5 revenue events. Then `POST /api/procurement/seed-workflow` → recipients from `procurement.txt` are loaded. Then `POST /api/procurement/fix-recipients` → dedup + cross-link POs to each of the 3 recipients. Then `POST /api/procurement/optimize` → local Morocco suppliers kick in (70–88% price cuts + qty-tier bulk discounts). Footer banner confirms pre-paid status for all 3 recipients.
5. **Owner Payouts.** When HIT Swarm tick #1 lands with externally-proven revenue of any amount > $0.01:
   - `POST /api/settlements/settle-and-payout` with `{ revenueEventId, amount, currency, sourceType, sourceRef }` → calls `settleAndPayout()` in `src/lib/payout-routing.ts`.
   - Net routes via the 5 owner accounts in fixed splits (Salary 40% → Attijari RIB 372; Settlements 30% → Banking Circle; etc).
   - Wise rail is READY (token valid). For PayPal: `owner-payout-paypal.mjs` submits a real batch with `paypal_batch_id` (TRUTH-004 enforced, no fabricated `processing`).
   - For Attijari MAD payouts: `scripts/approve-bankwire.js` → `POST /api/attijari` → MT103 rail, verified by `scripts/watch-bank-wire.mjs`.
6. **RWC course media.** Set 3 env vars: `IMAGE_GEN_API_KEY` (Together) + any of `VIDEO_GEN_API_KEY` / `REPLICATE_API_TOKEN` / `GOOGLE_AI_STUDIO_KEY` + `ASSET_BASE_URL` (pub CDN). Then run:
   ```
   node scripts/course-video-producer.mjs --all --images --videos
   node scripts/rwc-course-media-audit.mjs
   ```
   Audit should flip to 302/302 PASS. Publishing auto-unblocks (MEDIA_CONTRACT gate).

### P2: Steady-state
7. Set `OWNER_KYC_STATUS=PASSED` explicitly in secrets (live disbursement gate in `settlement-engine.ts` Stage 1 `VERIFY_COMPLIANCE`).
8. Onboard the 9 Morocco local supplier entries into `Supplier` table with their payment terms so the optimization-engine re-routes are backed by real POs, not just price annotation.
9. Add www.realworldcerts.com to Vercel project domains (vercel.json → `domains` array) after course media passes audit.
10. Mirror the Vercel deploy to the other 2 Space-Z endpoints so all 3 public UIs (b1fx661 · t1trn6kun · supply-chain-swarm.vercel.app) are in sync.

---

## Z.ai / Base44 Guardrails (implemented 2026-08-29)

Two hardened guardrails now ship in `swarm-ops-project/src/app/api/swarm/daemon/route.ts` + `swarm-ops-project/src/lib/journal/append-only.ts`. They are code-enforced (fail-closed) — no owner-side config required to benefit.

### 1. Append-Only Daemon Journal (write-once + SHA-256 hash chain)
- Every daemon tick (start / completed / failed) is written as JSONL to `data/swarm/journal/journal.jsonl`.
- Each line: `{ seq, ts, prev, entryHash, payload }` with `entryHash = SHA256(prev + seq + payload)`.
- Integrity semantics mirror `AuditLedger` (see `prisma/schema.prisma:447` hash-chain model).
- **Write-once enforcement:** after each `fsync()` the journal file is flipped to OS read-only (Windows `attrib +R`, POSIX `chmod 444`). The daemon briefly clears the attribute *only* to append the next line, then re-flips. No truncate or mid-file rewrite is possible without leaving a chain break.
- **Double-writer lock:** a `.journal.jsonl.lock` atomic lock serialises parallel cron ticks.
- **Seal:** at tick end, `journalSeal()` appends a terminal `{ tick:"seal", sealed:true, chainTail }` entry with the current tail hash, so future processes can never append without leaving a visible chain gap.
- **`openJournal()` always validates the chain** on first call: if any `rec.prev ≠ expectedPrev` or the recomputed `entryHash` mismatches, the daemon logs `CHAIN BROKEN` and stays in read-only mode (deploy/delivery never run).
- API reference:
  - `swarm-ops-project/src/lib/journal/append-only.ts:openJournal()`
  - `swarm-ops-project/src/lib/journal/append-only.ts:journalAppend()`
  - `swarm-ops-project/src/lib/journal/append-only.ts:journalSeal()`

### 2. Read-Only Execution Gate (2-tier fail-closed)
Deploy/delivery writes NEVER run unless ALL three are true:
- `PLAN_TRANSITION_MODE` ≠ `"1"` (tier-1: Z.ai plan-transition isolation)
- `OWNER_EXEC_UNLOCK` env var **set and ≥ 16 chars** (tier-2: owner-granted write permission)
- `verifyPayoutGuard().passed === true` (tier-0: existing real-proof payout guard)

If any one fails the daemon still runs `reconcile → guard → fusion` (assessment-only) and surfaces `execGate.reasons` in the response and journal. The gate is fail-closed: **unreadable env → treated as unset → read-only**.

API reference:
- `swarm-ops-project/src/app/api/swarm/daemon/route.ts:resolveExecGate()`
- `swarm-ops-project/src/app/api/swarm/daemon/route.ts:isAuthorized()` — KMS JWT is preferred; CRON_SECRET fallback available but logs `not KMS-signed` into the exec gate reasons.

---

## GLM-5.3 / ZCode Integration (deployed apps call sites)

### Request params applied everywhere
For **any** model ID matching `glm-5.3` (case-insensitive, including `zhipuai/glm-5.3`, `zai-glm-5.3`, `glm-5.3-flash`, `glm5.3`, `glm_5_3`) or exactly `zcode`, the request body is transparently rewritten to add:
```json
{ "model": "glm-5.3", "thinking": "enabled", "reasoning_effort": "low" }
```

**Call sites covered:**
1. **Main project router (production):** `src/lib/dynamic-router.ts:callOpenRouter()` → OpenRouter / local engine routing.
2. **Swarm-ops helper:** `swarm-ops-project/src/lib/free-models.ts:buildChatCompletionBody()` → any Z.ai/OpenRouter/ZCode consumer in the swarm project.

**Model catalogue entries added:**
| id | name | provider | endpoint |
|----|------|----------|----------|
| `zhipuai/glm-5.3` | GLM-5.3 (OpenRouter · reasoning) | openrouter | https://openrouter.ai/api/v1/chat/completions |
| `zhipuai/zcode` | ZCode (code-native GLM) | openrouter | (same) |
| `zai-glm-5.3` | GLM-5.3 (Z.ai · reasoning) | zai | https://api.z.ai/api/paas/v4/chat/completions |
| `zai-zcode` | ZCode (Z.ai) | zai | (same) |
| `local-glm-5.3-flash` | GLM-5.3-Flash (Phase-4 self-hosted) | glm_local | http://localhost:8000/v1/chat/completions |

### Phase-4 local option (zero-cost, private)
When the swarm moves off third-party LLM APIs:
```
ENGINE:   vLLM ≥ 0.6.0  OR  SGLang ≥ 0.4.0  OR  OpenClaw
MODEL:    THUDM/glm-5.3-flash (GGUF / AWQ / FP8, 70B or 128B)
ENVS:     GLM_LOCAL_BASE_URL=http://localhost:8000/v1
          GLM_LOCAL_API_KEY=<any-shared-secret≥16chars>
```
Once envs are set, every call to a `glm-5.3` model ID transparently routes to the local engine via `callOpenRouter` — no caller code changes required.

---

## Treasury Buckets Migration (PayoutRoutingRule · FundBucket)

### New Prisma models (lines 765–798 in `prisma/schema.prisma`)
- **`FundBucket`** (code PK): `sovereign_reserves (30%)` · `procurement_buffer (10%)` · `runtime_operations (20%)` · `salary_bucket (40%)`. Monotonic counters `allocated - released = balance`.
- **`PayoutRoutingRule`**: matches `sourceType` + `sourceFilter` JSONB and distributes NET via `destinationSplits` JSONB. The default rule routes the split above into the 4 buckets.

### Migration file (ready to apply)
- **Path:** `prisma/migrations/20260829000000_add_treasury_buckets_routing/migration.sql`
- **Idempotent:** `CREATE TABLE IF NOT EXISTS` + `INSERT … ON CONFLICT DO NOTHING` seeds the 4 buckets + the default routing rule.
- **Apply after Neon DATABASE_URL is correctly set:**
  ```
  npx prisma migrate deploy         # applies via _prisma_migrations table (preferred for Neon)
  npx prisma db push                # or, if you want to skip the migrations table for this schema-only deploy
  ```

### Runtime wiring
- Bucket split engine: `src/lib/treasury/buckets.ts:computeBucketSplit()` + `allocateToBuckets()`
- Seeded by `scripts/seed-pos.mjs` lines 147–179 (raw SQL inserts, idempotent)
- Wired into settlement flow at `src/lib/settlement-engine.ts:SplitBreakdown.buckets` Stage 3.5 and `src/lib/payout-routing.ts:treasury fallback splits`.

---

## Blocked Items (Owner Dashboard Actions Required)

| Blocked Item | Root Cause | Unblock Action |
|--------------|------------|----------------|
| **Vercel redeploy** of `supply-chain-swarm.vercel.app` from latest commit | Secrets in Vercel dashboard contain `[SENSITIVE]` placeholder; `VERCEL_TOKEN`/`VERCEL_ORG_ID`/`VERCEL_PROJECT_ID` not set in GitHub repo secrets. | Set 4 GitHub repo secrets (deploy-vercel.yml) OR push Redeploy button on Vercel dashboard with real env values. |
| **HIT Swarm `x1he4604ap01`** redeploy + first revenue tick | No `SPACEZ_TOKEN` in repo; no direct redeploy API call possible. Dashboard action only. | Space-Z dashboard → x1he4604ap01-d → Redeploy / Fetch Latest Commit → Autopilot ON → Run Tick → capture first externally-proven RevenueEvent > $0.01. |
| **No deliverable finance rail** (PayPal CIP pending, Wise rejected) → no real proved RevenueEvent | PayPal Business account CIP not cleared; Wise application declined. Finish banking setup before the swarm can disburse real owner funds. | **Owner → PayPal dashboard:** complete Customer Identification Program (CIP). **Owner → Wise:** re-submit KYC or switch to a different bank-wire PSP (Attijariwafa/CIH direct → use scripts/approve-bankwire.js). **Owner payout rail env:** set `OWNER_PAYOUT_RAIL=iban` + `OWNER_PAYOUT_CURRENCY=USD` (or MAD) + the corresponding IBAN/RIB env vars in Vercel. |
| **RWC 302/302 course media** (buildVideos() throwing stub, image 402) | `OPENROUTER_API_KEY` unfunded (402 Payment Required); missing `IMAGE_GEN_API_KEY`, `REPLICATE_API_TOKEN`, `ASSET_BASE_URL`. | Fund OpenRouter balance OR provision a separate `IMAGE_GEN_API_KEY` (Together, FLUX.1-schnell) + `REPLICATE_API_TOKEN` (video) + `ASSET_BASE_URL` (R2/S3/Supabase CDN public). Then run: `node scripts/course-video-producer.mjs --all --images --videos && node scripts/rwc-course-media-audit.mjs`. |
| **Procurement Bachir first (June-20 deadline, overdue)** — real vendor payment | Real Moroccan vendor checkout needs owner MMB (Attijari Mobile Money) or CMI card; swarm has no card writer. | **Owner → load MMB/CMI card:** fund MMB wallet (Attijari) or use a CMI debit/credit card under the owner's name, then run the 4-step procurement pipeline (seed-pos → /procurement/seed-workflow → fix-recipients → optimize). Pay Bachir first: SuperFood nitric/diabetes packs (SuperFood.ma, 88%) + Paco Rabanne/Montblanc perfumes (Parfumerie Agdal, 85%) + Tablet CR10.1 + ortho slippers (Medical Supply Rabat, 82%) — all billed to card, all marked PRE-PAID BY SWARM in UI banner so Bachir pays $0. Then Hind, then Younes. |
| **Neon DB schema sync** for new buckets/routing tables | Earlier deploys ran only `prisma generate` (never `migrate deploy`), so `FundBucket`/`PayoutRoutingRule` never landed → `payoutRoutingRule.findMany`/`fundBucket.upsert` would throw at runtime → settlements aborted → "OWNER accounts received nothing". **FIXED in deploy-vercel.yml**: added `npx prisma migrate deploy` step after generate. | Next successful `main` push (or `workflow_dispatch` deploy) applies the migration + seeds the 4 buckets + default 30/10/20/40 routing rule against Neon automatically. Verify: `SELECT * FROM "FundBucket"` returns 4 rows; `/api/healthz` 200. |

---

## Owner Request: Secrets & Dashboard Actions to Unblock the Runbook

The following items cannot be performed from the repository sandbox (they require owner credentials, bank access, funding, or dashboard sessions). Please set or perform them when you return:

**1. Vercel / Deploy secrets (set in GitHub repo → Settings → Secrets and variables → Actions):**
- `VERCEL_TOKEN` (Project-scoped, created at vercel.com → Tokens)
- `VERCEL_ORG_ID` (vercel.com → Team → Settings → General → ID field)
- `VERCEL_PROJECT_ID` (vercel.com → `supply-chain-swarm` project → Settings → General → ID)
- `DATABASE_URL` (Neon Postgres pooled connection string — starts `postgresql://`)

> **Provisioning is now automation-driven.** `deploy-vercel.yml` (step "Provision OWNER runtime env vars (production)") mirrors the vars below from GitHub Actions secrets into the Vercel production project on every deploy. Set the VALUES as Actions secrets and they become Vercel env vars automatically (masked, idempotent, preview unaffected).

**2. Vercel project env vars → set as GitHub Actions secrets (workflow mirrors them to Vercel on deploy):**
- `OWNER_EXEC_UNLOCK=` — ≥ 16 random chars; enables daemon deploy/delivery writes (else read-only per guardrail §2).
- `OWNER_PAYOUT_RAIL` (OPTIONAL preference — per "All roads lead to Mecca", omit or set any of `iban`/`sepa`/`ach`/`crypto`/`card_token`; the resolver auto-picks the best available account, e.g. `crypto` undervalued → falls through to bank/paypal/etc.)
- `OWNER_PAYOUT_CURRENCY=USD` (or `MAD` for Attijari) — the resolver treats same-currency routes as cheapest (no FX), so set this to the dominant revenue currency.
- `OWNER_KYC_STATUS=PASSED` (enables settlement-engine `VERIFY_COMPLIANCE` gate)
- `PLAN_TRANSITION_MODE=0` (unless the workspace is mid-migration; 0 = writes allowed after OWNER_EXEC_UNLOCK set)
- `OWNER_PAYOUT_IDENTIFIER` / `OWNER_PAYOUT_COUNTRY` / `OWNER_PAYOUT_HOLDER_NAME` / `OWNER_PAYOUT_BANK_BIC` (env-preset fallback destination; the DB pre-set account table § "Owner Pre-Set Payout Accounts" is the primary source)
- Real payout rail env values for your selected rail (IBAN, RIB 372, PayPal email, Wise profile ID, USDC Arbitrum `0xA462…`, etc.)

> **Routing no longer requires the single preset to be "complete".** `resolveBestPayoutRoute()` reads the DB OwnerAccounts first (Banking Circle, PayPal, USDC Arbitrum, Payoneer, Attijari RIB — all already seeded), so disbursement proceeds even before an env preset is added.

**3. Space-Z dashboard (for HIT Swarm revenue engine):**
- Instance `x1he4604ap01-d` → **Redeploy** / Fetch Latest Commit.
- After deploy: dashboard → Autopilot **ON** → **Run Tick**. Confirm first RevenueEvent lands with `proofType ≠ manual_attestation` and `amount > 0.01 USD`.

**4. RWC media (3 env vars, provision and set in Vercel + runner env):**
- `IMAGE_GEN_API_KEY=` (together.xyz flux-schnell key)
- `REPLICATE_API_TOKEN=` (or `VIDEO_GEN_API_KEY` / `GOOGLE_AI_STUDIO_KEY`)
- `ASSET_BASE_URL=` (R2/S3/Supabase public bucket URL, no trailing slash)

**5. Finance / procurement (owner actions, no code):**
- **PayPal Business dashboard:** finish CIP (Customer Identification Program) so payouts can settle.
- **Wise:** re-apply or use Attijariwafa direct bank-wire rail for Attijari RIB 372.
- **MMB / CMI card:** fund an Attijari Mobile Money wallet or use a CMI debit card in the owner's name; we will then route Bachir POs through it first (June-20 deadline orders).

Once items 1 + 2 + 5 (at least one rail) are set, please notify me and I'll: trigger the deploy workflow, run the 4-step procurement pipeline (Bachir first), then push to settle-and-payout the first externally-proved HIT Swarm revenue to the 5 preset owner accounts.

## 2026-09-07 — Payout pipeline driver live (P0/P1 close-out)

**Problem closed:** the state machine, ledger, eligibility engine and provider
seam existed but had NO driver — payouts reserved funds (RESERVED) and stalled.
Nothing executed beyond RESERVED. Ever.

**Landed:**
- `src/payout/pipeline.ts` — the driver. Advances every drivable payout one
  legal transition per tick: CREATED→ELIGIBLE (hold check) →RESERVED (ledger
  reservation, derived-balance guard) →VALIDATED (fingerprint/idempotency/caps)
  →READY →SUBMITTING (version-CAS claim) →SUBMITTED (provider submit) →
  PROCESSING →COMPLETED (provider evidence ONLY) →RECONCILED (settled ledger
  line). Failure branches stay honest: ambiguous submit → UNKNOWN (never
  re-submitted; resolves only via provider reconciliation or quarantine),
  fail-closed rail → RETRYABLE_FAILURE, submit throttle 3/day, daily settle cap.
- `src/payout/adapters/paypal-live.ts` — real PayPal Payouts API wiring (P2,
  owner-authorized). Idempotency-Key = payout idempotencyKey (replays return
  the same batch — never double pay). Destination fingerprints resolve to raw
  emails ONLY inside the OwnerAccount boundary.
- `src/payout/prisma-driver.ts` — transactional store: version CAS + immutable
  PayoutEvent + idempotent RevenueLedgerEntry in ONE transaction.
- `POST /api/payouts/tick` — hourly entry point. Fail-closed: requires
  `PAYOUT_TICK_SECRET` header; live rails additionally require
  `SWARM_LIVE` + `PAYPAL_PPP2_APPROVED` + `PAYPAL_PPP2_ENABLE_SEND` + creds;
  otherwise providers run dry-run (honest UNKNOWN — never fabricated evidence).
- `src/payout/__tests__/pipeline.test.ts` — 28/28 green: full happy path,
  UNKNOWN-never-retried, crash-leftover SUBMITTING, quarantine actors,
  fail-closed submit, reservation integrity, version CAS.

**Ops:** point the hourly cycle at `POST /api/payouts/tick` with header
`x-tick-secret: $PAYOUT_TICK_SECRET`. Nothing else is required; the tick is
bounded (default 50 payouts/call) and idempotent.

## 2026-09-07 — Driver coexistence contract (pipeline.ts + dispatch/reconcile)

Two payout execution modules now exist side by side. Contract so there is
never ambiguity about who drives what:

- **`src/payout/pipeline.ts` + `POST /api/payouts/tick` — the autonomous hourly
  engine** (owner-mandated hands-free settlement). Drives the full lifecycle
  CREATED→…→RECONCILED including dispatch from READY. Live rails stay
  fail-closed (SWARM_LIVE + PPP2 gates + credentials) and live PayPal is wired
  via `adapters/paypal-live.ts` (Idempotency-Key deduped).
- **`src/payout/dispatch.ts` + `src/payout/reconcile.ts` — the manual/approval
  path** (owner-actor approval signature required before dispatch from READY).
  Not wired to any endpoint; reserved for owner-approval flows.

Double-execution is structurally impossible: both paths dispatch only from
READY behind the same optimistic version CAS — one claim wins, the other
refuses — and both dedupe on the payout idempotencyKey at the provider seam.
The tick and the approval path may coexist; they never race into a second
money movement.

## 2026-09-07 — REMOVED ungated duplicate crypto-withdraw workflow (main.yml, commit "xctut")

The commit "xctut" added `.github/workflows/main.yml` — a live Binance USDT
withdrawal trigger that duplicated `owner-crypto-withdraw.yml` while stripping
EVERY safety gate: no CRYPTO_WITHDRAW_ENABLE fail-closed switch, no
CRYPTO_ALLOWED_ADDRESSES allowlist, no audit-only mode, no amount validation,
unmasked logs, and a 30-day PUBLIC artifact of withdrawal results on a public
repository. This violates the settlement constitution (fail-closed, gated
disbursement) and the secret-exfiltration mandate.

The hardened `owner-crypto-withdraw.yml` already provides the same
workflow_dispatch capability WITH all gates intact (allowlist, enable switch,
audit-only, log masking). Anyone needing the withdraw button should use that
one. If main.yml was intentional, re-land it WITH the gates — never without.

## 2026-09-07 — AUTONOMOUS SELF-HEALING BLUEPRINT (devops-self-healing)

**Problem class:** workflow-level `concurrency:` groups mirrored by job-level
`concurrency:` groups with the SAME name. GitHub holds the workflow-level lock
for the run's entire lifetime, so the job can never acquire the same-named
group and is auto-failed at run creation — no runner, 0 steps, no logs
(`completed_at <= started_at`). Monitoring inside jobs sees nothing; this
killed all three Actions money paths (autonomous-tick, owner crypto withdraw,
owner PayPal payout) silently since 2026-09-02 (commit 061faa3).

**The blueprint (all live on main):**

1. **Static Engine — `scripts/lint-workflow-concurrency.mjs`**
   IaC pre-flight gate. Dependency-free Node. Lint mode exits 1 on any
   workflow-level/job-level concurrency name collision (blocking CI step in
   `devops-self-healing.yml` → deadlocks cannot reach production).
   `--fix strip` deletes the offending job-level block; `--fix suffix`
   force-suffixes the group name instead.

2. **Dynamic Engine — `scripts/devops-self-healing.mjs`**
   Logless control-plane scraping via the Actions REST API. Deadlock
   signature: `conclusion=failure` + `runner_id=null` + `steps=0` +
   `completed_at <= started_at` (+ job logs 404). Maps signature events to
   workflow files, confirms with the static engine, then the Active
   Repairman strips the duplicate block and pushes a repair commit.
   Also runs a proactive static sweep so rarely-dispatched workflows
   (e.g. owner-payout) are repaired before their first dead run.

3. **Circuit Breaker** — if repairs fire >3 consecutive hourly cycles,
   the engine alerts: external webhook (`SELF_HEALING_ALERT_WEBHOOK`
   secret) + GitHub issue labeled `self-healing,circuit-breaker`, and
   latches until a clean cycle resets it.

**Workflow:** `.github/workflows/devops-self-healing.yml`
- hourly cron (Passive Scanner) + push trigger (Static Engine gate) + manual dispatch
- `static-gate` and `heal` run INDEPENDENTLY — a red gate must never block
  the repairman from fixing the very thing the gate complains about
- the workflow itself is deadlock-free BY DESIGN (workflow-level group only)

**Bootstrap (one-time, owner actions):**
1. Commit `.github/workflows/devops-self-healing.yml` (a copy ships at
   `docs/bootstrap/devops-self-healing.yml.txt` — paste it into
   `.github/workflows/` via the GitHub UI, or move it once a
   workflow-scoped PAT is available). GITHUB_TOKEN alone cannot push
   workflow-file changes; that is a GitHub platform restriction.
2. Set the repo secret `SELF_HEALING_TOKEN` = PAT with `repo` + `workflow`
   scope (falls back to `GITHUB_PAT_WORKFLOW_SCOPE`). Without it the
   scanner still scans + reports + alerts, but cannot push repairs.
3. Optional: `SELF_HEALING_ALERT_WEBHOOK` for the emergency channel.

**Runbook / failure modes:**
- `signature seen but static engine finds no duplicate concurrency` →
  either already fixed (benign, history still holds dead runs) or a
  NOVEL pre-runner failure — manual review.
- `REPAIR PUSH FAILED` → SELF_HEALING_TOKEN missing/lacking `workflow`
  scope, or branch protection. Repairs remain in the report + artifact.
- Circuit breaker alert firing repeatedly → something keeps REINTRODUCING
  duplicate groups; audit commits touching `.github/workflows/`.
