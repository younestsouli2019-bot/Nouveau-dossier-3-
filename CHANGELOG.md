# Changelog

## [2026-08-28]
- feat(ledger): Authorizer Ledger — persistent, double-entry, revenue-split handshake + liquidity-buffered clearing in Postgres. New Prisma models `LedgerAccount`, `RevenueLedgerEntry`, `ClearingBatch` (accounts 1000/1001/1050/2050/3000/4000/5000: inbound split 1050/4000/5000 + outbound clearing 1000/1001/2050/3000). `scripts/authorizer-ledger.mjs` implements `setup` (raw-pg DDL + account seed + plpgsql `route_incoming_revenue`), `route`, `status`, `report`. Replaces the ephemeral in-memory settlement ledger; anti-fabrication guard (no leg may reach SETTLED/CLEARED without a real external proofRef). Verified live on Neon: $100 inbound → $95 Owner-Payable + $5 Platform-Revenue + $100 Processor-Receivable; idempotent; synthetic test row removed to keep ledger honest. Report: `data/out/authorizer-ledger-report.json`.
- feat(rails): honest rail health report `scripts/rail-health-report.mjs` → `data/out/rail-health-report.json` reconciling config-claimed "open" rails against measured deliverability (PayPal 403 AUTHORIZATION_ERROR pending CIP, Binance `-2015`, Bitget auth-OK-but-empty, Bybit $0, Wise invalid_token, PI/Stellar no creds; deliverable outbound rails = none pending PayPal CIP clearance).
- fix(security): `scripts/owner-payout-paypal.mjs` previously hardcoded live PayPal PPP2 client ID + secret. Refactored to read `PPP2_CLIENT_ID`/`PPP2_CLIENT_SECRET` from env (gitignored) and emit a clear error if missing. Removed the secret from commit history (ammended unpushed head) before push. Verified `git diff` of the full to-be-pushed range is secret-clean (scanned for GitHub PATs, Stripe, AWS, PayPal, Base44, Wise, Bitget tokens).
- chore(infra): pushed commits `a93a5fa6a5`, `8cd2de08a6` to `https-origin/main` (`36a410b940..8cd2de08a6 main -> main`); remote in sync. Vercel `supply-chain-swarm` deployment Ready/Current (build passes; `/api/supplier-portal` `DYNAMIC_SERVER_USAGE` is a build-time warning, not a failure).
- note(deploy-urls): swarm deploy targets referenced this cycle: `https://t1trn6kunnv1-d.space-z.ai`, `https://x1he4604ap01-deploy.space-z.ai/`, `https://b1fx661hzse0-d.space-z.ai/`.
- note(integrity): pasted prior-session claims (e.g. `@/lib/connectors` module, `src/lib/base44-client.ts`, 7 "architecture redress" Prisma models, 355-commit narrative) do NOT match the actual repo; verified absent. Also `swarm-ops-project/` is a separate nested git repo (own remote) and is correctly left out of the outer repo. `Prisma db push` (P1001) fails on the Neon pooler host; ledger schema is applied via raw-pg DDL in `setup`.
- fix(security): scrubbed the embedded GitHub PAT from the `nosim` git remote (`.git/config`). Remote URL rewritten to the clean `https://github.com/www-realworldcerts-com/realworld.nosim.git`; confirmed no `github_pat`/`x-access-token` remains in local config. ACTION ITEM: the previously-embedded fine-grained PAT should be revoked/rotated in GitHub (Developer settings) since it sat in plaintext config. Vercel `supply-chain-swarm` app confirmed connected to this repo (auto-deploy Ready/Current); `.vercel/` (incl. `env.production.local` prod secrets) verified gitignored + untracked. `deploy-pages.yml` needs GitHub repo secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` — to be added via GitHub UI (gh CLI not authenticated here).
- feat(swarm-memory): Persistent Swarm Memory + Anticipation Foundation — replaces the ephemeral in-memory/flat-file swarm memory (`src/swarm/shared-memory.mjs`, `src/lib/swarm/memory-isolation.ts`) with durable Postgres-backed tables on the same Neon DB as the ledger: `SwarmMemoryKV` (get/set + read/write map), `SwarmAgentContext` (context retention), `SwarmDecision` / `SwarmSuggestion` (anticipation engine → ranked least-risk next actions + probable-intent probabilities), `SwarmErrorLog` (error recovery + graceful-degradation policy), `SwarmIntegration` (external integration registry; never stores secrets; seeded with honest measured rail statuses). `scripts/swarm-memory.mjs` implements `setup` (idempotent raw-pg DDL, no secrets), `get/set/read/write/context/decide/suggest/error/integration/status`. Drop-in compatible `PersistentSwarmMemory` class exposes both map (`get`/`set`) and file (`read`/`write`/`appendLog`) interfaces. Verified live on Neon end-to-end (KV, context retention, decide→suggest ranking, error log, integration registry); synthetic test rows removed to keep memory honest (integration registry retains only real rail statuses).


## [2026-08-04]
- feat(swarm): multi-machine task queue — `src/task-queue.mjs` atomic lease-based queue (mkdir-atomic `claim()`, enqueue/list/stats/complete/fail, `reap()` for expired leases, `clear()`), plus `runCommand`/`gitCommand` helpers for spawning workers; `src/task-orchestrator.mjs` handler map (`run-tests`, `edu:*`, `swarm:supervisor`) with `processOnce`/`runLoop` + git pull --rebase sync; `src/task-queue-cli.mjs` (enqueue/list/process/loop/reap/clear); `scripts/spawn-parallel-workers.mjs` spawns N loop workers (default 2) with `data/swarm/workers/manifest.json`.
- feat(daemon): autonomous-daemon wired into task queue — `cfg.tasks.taskQueue` (env `AUTONOMOUS_TASK_QUEUE`, interval `AUTONOMOUS_TASK_QUEUE_INTERVAL_MS`, `AUTONOMOUS_TASK_QUEUE_MAX_PER_TICK`, `AUTONOMOUS_TASK_QUEUE_PULL`); `maybeRunTaskQueue` processes claimed leases per tick, skips in offline mode; exported for tests.
- fix(ledger): resolved `data/financial/settlement_ledger.json` merge conflict (stale `<<<<<<< Updated upstream` markers committed at HEAD); kept upstream side — 23 transactions incl. `tx_1768336443897_38c4044b3a`; file now parses clean.
- Tests: 303 passing (taskQueue 17, daemon taskQueue integration 7 added → 296 + 7 = 303).
- infra: pushed `fc6fef962d` (ledger fix), `421fd4bd77` (task queue), `137270e75d` (changelog) to origin/main; remote in sync.

## [2026-08-02]
- feat(edu): Agentic Course Factory — `OpportunityAgent` (niche scanning, seeded ranking, CREATE NOW/WATCH/IGNORE verdicts), `CurriculumArchitect` (module frameworks, per-module quizzes, humanized copy), `VideoDirector` (scene timelines, renderer plan, ffmpeg detection), wired end-to-end via `CourseFactory.createCourse` (idea→opportunity→curriculum→script→video→publisher) and `course-factory-cli.mjs` (preview/publish).
- feat(edu): research-to-script pipeline with anti-hallucination claim gating — `ResearchAgent.brief` classifies claims as well-known/verified/unverified against a knowledge base and supplied sources; `ScriptWriter` only narrates verified claims, hedges when unverified claims remain; `research-script-cli.mjs`.
- feat(edu): realworldcerts.com standards audit — `SiteStandardsAuditor` grades SEO title/description, pricing, social proof, affiliate visibility, cert objectives, trust, CTA, mobile, human copy, and sales mapping (grade + verdict + per-check actions); `standards-audit-cli.mjs`.
- feat(edu): niche catalog expanded 8 → 16 (caregivers, tutoring, home organization, pregnancy nutrition, veteran grants, EV ownership, sourdough baking) with trend topics and knowledge-base entries for tutoring/baking/EV.
- feat(edu): analytics feedback loop — `CourseAnalytics` ingests per-module completion/quiz/dropoff and sale conversion, returns price signals (raise/lower/keep), module health actions (rewrite_quiz/shorten/reorder/keep), and next-topic suggestions from the opportunity scan; `analytics-loop-cli.mjs` closes the idea→course→improve cycle.
- Tests: 279 passing (opportunity 6, curriculum 7, video 6, courseFactory 5, research 7, script 7, standards 8, analytics 8).
- infra: pushed research-to-script (`a2db044822`), standards/niche (`18ffa0473b`), changelog (`ba97e329ee`), and analytics (`7b649d3493`) commits to origin/main; remote in sync.

## [2026-02-01]
- Added hourly Autonomous Scheduler (agents registration, headhunter discovery, autonomous tick, readiness ping, catalogue build, truth marker write, auto-commit/push).
- Integrated headhunter discovery into supervisor cycle for continuous agent onboarding.
- Added local .env loader and optional NaCl secretbox decrypt for encrypted env.
- Introduced Org Broadcast workflow to dispatch agentic_tick across organization repos.
- Generated catalogue_master.pdf with fallback to placeholder when assets are missing.
- Maintained safety rails for owner routing and bunker mode kill switch; no secrets committed.

## [Unreleased] - 2026-01-19

### Autonomous Finance & Enforcement
- **feat(finance):** Implemented `ReplenishmentProtocol` to autonomously maintain a $50k Reserve Balance.
- **feat(finance):** Implemented `ExternalPayerEnforcer` to identify overdue payers and block new work ("No Pay, No Delivery").
- **feat(finance):** Implemented `PaymentAssuranceProtocol` to gate MissionOrchestrator based on payer standing.
- **feat(finance):** Executed "Sovereign Sweep" transferring ~$27.7k from Platform Wallets (Binance, Kraken, PayPal) to OWNER.
- **feat(finance):** Updated `ExternalPayerEnforcer` to target specific entities: Nimbus Analytics, BluePeak Consulting, Acme Software.

### Autonomous Self-Healing
- **feat(autonomy):** Added `SelfHealer` module to detect and fix missing module/script errors automatically.
- **feat(autonomy):** Integrated Healer, Enforcer, and Replenisher into `autonomous-daemon` main loop.
- **fix(scripts):** Created missing reconciliation scripts (`recover-psp-proofs`, `reconcile-amount-mismatches`, `emergency-settlement`).

### Infrastructure
- **chore:** Updated `autonomous-daemon.mjs` to run all new autonomous modules in a continuous loop.
