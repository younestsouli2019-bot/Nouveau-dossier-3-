# Changelog

## [2026-08-02]
- feat(edu): humanized LearnWorlds publishing (AI-tell stripping, natural copy, instructor persona) default-on via `EDU_HUMANIZE`.
- feat(edu): RealWorldCerts main-site client with HMAC webhook verification and normalized sale handling.
- feat(edu): affiliate program with `RWC-` referral codes, recruitment loop, conversion recording, leaderboard, owner-gated payouts.
- feat(edu): 10-storefront registry (realworldcerts primary + teachable/learnworlds/udemy/skillshare/skool/whop/lemon-squeezy/gumroad/github-sponsors).
- feat(edu): webhook routes `/webhook/realworldcerts` and `/webhook/affiliate`; reconciliation hooks for main-site sales + affiliate conversions.
- scripts: `edu-storefront-status.mjs`, `affiliate-program-cli.mjs`; package.json `edu:storefronts`, `affiliate:status`, `affiliate:recruit`.
- Tests: 225 passing (humanize 11, learnworldsPublisher 9, mainSiteClient 4, affiliateProgram 6, storefrontRegistry 4, reconciliation 8, and more).
- infra: force-pushed local `main` to `origin/main`; repo_nd3 remote removed; legacy agent tree preserved on `origin/trae/agent-71cE3g`.

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
