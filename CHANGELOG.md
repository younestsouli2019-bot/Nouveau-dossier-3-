# Changelog

## [2026-03-31]
- feat(security): Added automated secrets scan + rotation checklist and policy status outputs
- feat(payments): Enforced hands-free settlement gating based on security posture and Plaid readiness
- feat(plaid): Added Plaid preflight readiness checks (prod mode + webhook HMAC requirement)
- feat(site): Added interactive classroom landing page and request capture endpoint
- feat(growth): Promoted interactive classroom CTA from auto-generated certification guides
- feat(swarm): Extended revenue swarm reporting with classroom demand metrics (24h + total)
- docs: Added OpenMAIC integration notes with licensing and architecture options

## [2026-03-20]
- feat(swarm): Validated next-level mission dependency graph and surfaced errors in supervisor output
- feat(swarm): Backfilled missing mission index entries when mission files already exist
- test(swarm): Added coverage for idempotent seeding + index backfill
- ops(backups): Refreshed snapshot and doomsday mirror artifacts (local-only; ignored by git)

## [2026-03-14]
- deploy(vercel): Verified vercel.json to serve rank/output via static routes
- ops(backups): Created doomsday zip at backups/doomsday/realworldcerts-site-YYYYMMDD-HHmmss.zip
- ops(mirrors): Prepared local mirrors at mirrors/vercel-public and mirrors/backup-1
- ops(crypto): Generated Bitget instruction files for owner payouts from archive CSV
- site(health): Confirmed robots.txt, sitemap.xml, and hubs live on realworldcerts.com

## [2026-02-25]
- feat(finance): Prepared historical payout artifacts across all rails (Payoneer, Wise, Bank Wire); added per-batch CSVs under settlements/*/historical and a consolidated settlements/payouts_index.json
- feat(scripts): Added generate-secondary-payouts-from-manifests.mjs and paypal-send-owner-payout.mjs to automate multi-rail preparation and micro confirmation
- chore(base44): Coordinated Base44 deployment via push-to-base44.mjs; deployment logs saved under audits/
- docs: Noted PRQ token/session expiry behavior for Payoneer confirmations

## [2026-02-12]
- **SECURITY CRITICAL:** Implemented strict validation to prevent unauthorized payments after detecting suspicious Barclays IBAN GB66BARC20958787123933 (Leicester, UK) in payment documents.
- **feat(security):** Added emergency payment lock mechanism with `EMERGENCY_PAYMENT_LOCK` environment variable to block all payments during security incidents.
- **feat(security):** Created `validateAuthorizedOwnerAccounts()` function to ensure only Younes Tsouli and authorized IBANs receive payments.
- **feat(security):** Implemented strict "NO PLACEHOLDER DATA" policy - all payment functions now fail with critical errors if owner configuration is missing.
- **feat(security):** Added comprehensive audit scripts (`emergency-payment-audit.js`, `quick-payment-audit.js`) to detect unauthorized payment files.
- **feat(finance):** Added multi-rail settlement support for Wise, GooglePay, Plaid.com, and CRYPTO in `auto_settlement_daemon.js`.
- **feat(finance):** Implemented CSV generation functions for manual payout processing across all payment rails.
- **feat(finance):** Enhanced `.gitignore` to exclude generated settlement files and directories.
- **feat(finance):** Updated environment variable configuration for owner payment credentials and thresholds.
- **chore:** Force-pushed changes to remote repository and updated Base44 service configurations.

## [2026-02-10]
- **feat(finance):** Added `wise` and `googlepay` as owner payment methods.
- **feat(finance):** Updated `owner-directive.mjs` and `owner-settlement.mjs` to include the new payment methods.

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
