# Changelog

## [2026-08-04]
- feat(swarm): multi-machine task queue — `src/task-queue.mjs` atomic lease-based queue (mkdir-atomic `claim()`, enqueue/list/stats/complete/fail, `reap()` for expired leases, `clear()`), plus `runCommand`/`gitCommand` helpers for spawning workers; `src/task-orchestrator.mjs` handler map (`run-tests`, `edu:*`, `swarm:supervisor`) with `processOnce`/`runLoop` + git pull --rebase sync; `src/task-queue-cli.mjs` (enqueue/list/process/loop/reap/clear); `scripts/spawn-parallel-workers.mjs` spawns N loop workers (default 2) with `data/swarm/workers/manifest.json`.
- fix(ledger): resolved `data/financial/settlement_ledger.json` merge conflict (stale `<<<<<<< Updated upstream` markers committed at HEAD); kept upstream side — 23 transactions incl. `tx_1768336443897_38c4044b3a`; file now parses clean.
- Tests: 296 passing (taskQueue 17 added → 279 + 17 = 296).
- infra: pushed `fc6fef962d` (ledger fix) and `421fd4bd77` (task queue) to origin/main; remote in sync.

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
