# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.1.0] - 2026-07-27 — "Crypto Rail"

### Added
- `scripts/crypto-payout.mjs` — `executeCryptoPayout()` rail function for the auto-settle pipeline. Supports **EVM (BSC, Ethereum, Polygon, Arbitrum, Base, Optimism)**, **TRON (TRC20 USDT)**, and **Solana (SPL USDC/USDT + native SOL)**. Token registry covers USDT, USDC, BUSD, DAI per chain.
- Wired crypto rail (rail 3) into `scripts/auto-settle-owner.mjs` as the final fallback after bank wire + PayPal. Gated by `CRYPTO_ENABLE=true` + `OWNER_CRYPTO_ADDRESS` + `CRYPTO_OWNER_PRIVATE_KEY`. Dry-run mode (`CRYPTO_DRY_RUN=true`) builds the transaction but does not broadcast.
- `scripts/setup-crypto.mjs` — autonomous credential self-setup (mirrors `setup-wise.mjs`): validates env, probes each RPC, derives owner address, writes `dist_rwc/crypto-setup.json`. Run with `npm run setup:crypto`.
- `.github/workflows/crypto-payout.yml` — scheduled rail execution every 6h (`15 */6 * * *`) plus manual `workflow_dispatch` for one-shot payouts. Conditionally installs `ethers`, `tronweb`, and `@solana/web3.js` based on the selected chain.
- `OWNER_CRYPTO_WHITELIST` env var — optional destination allow-list that gates every send on top of `EMERGENCY_PAYMENT_LOCK`.
- Per-chain RPC overrides: `RPC_BSC`, `RPC_ETH`, `RPC_POLYGON`, `RPC_ARBITRUM`, `RPC_BASE`, `RPC_OPTIMISM`, `RPC_TRON`, `RPC_SOLANA`. Defaults use public endpoints; production should point to Alchemy/QuickNode/Infura.
- New `npm` scripts: `setup:crypto`, `crypto:payout`, `crypto:chains`.

### Security
- Crypto rail honors `EMERGENCY_PAYMENT_LOCK` (refuses every send when set).
- Optional `OWNER_CRYPTO_WHITELIST` blocks broadcasts to non-whitelisted addresses.
- Private keys are loaded from env only (never read from disk).
- Per-chain chain-id verification before broadcast.
- Dry-run is the default; the rail is `CRYPTO_ENABLE=false` until the owner explicitly flips it.

### Notes
- The `executeCryptoPayout()` function was previously documented as rail 3 in `auto-settle-owner.mjs` (header comment) but had no implementation. This release closes that gap.
- The existing `L2/` Ecosystems Monitor remains a read-only scanner (no signing); this release does not turn it into a payout engine.

## [3.0.0] - 2026-07-26 — "Autonomous Feed-Attijari"

### Added

**Recovery**
- `scripts/backfill-false-completed-wires.mjs` — flips false-completed wires to processing
- `scripts/promote-batches-to-pending.mjs` — promotes never-submitted wires to pending
- `scripts/regenerate-wire-instructions.mjs` — fresh operator instructions per day

**Attijari portal automation**
- `scripts/attijari-autofill.mjs` — Puppeteer auto-fill of the Attijari-PayPal portal
- `scripts/auto-execute-wire.mjs` — full autonomous Banking Circle → Attijari flow
- `scripts/generate-portal-instructions.mjs` — bridge Base44 PayoutBatch → portal format
- Cross-platform Chrome path detection (Windows/Mac/Linux) in both Puppeteer scripts
- Headless mode support (`--headless` flag, `PUPPETEER_HEADLESS=true`)

**Banking Circle direct API**
- `scripts/banking-circle-direct-wire.mjs` — OAuth2 client_credentials + POST /v1/payments
- `scripts/settle-owner-wise.mjs` — Wise API fallback
- No-Puppeteer path for flaky networks

**Offline ledger & revenue**
- `scripts/seed-offline-ledger-recovery.mjs` — writes recovery batches to `.base44-offline-store.json`
- `scripts/ingest-manual-revenue-ledger.mjs` — owner-maintained JSON ledger → RevenueEvent
- `revenue-ledger.example.json` — schema template
- `scripts/auto-attijari-wire.mjs` (offline-ledger mode) — generates wire packets + copy-paste cards

**Daemon & watchdog**
- `scripts/feed-attijari-daemon.mjs` — long-running polling orchestrator (every 60s)
  - Auto-detects which credential set is present
  - Routes to BC direct, Wise, Puppeteer, or offline-ledger path accordingly
  - Idempotent, safe to run in parallel
- `scripts/feed-attijari-watchdog.mjs` — monitors daemon, restarts on crash, runs full pipeline every 10 cycles
- PID files for clean shutdown

**Deployment**
- `deploy-feed-attijari.ps1` — 8-step PowerShell deployment (pull → clean → install → seed → generate → detect creds → start daemon → report)
- `deploy-attijari.cmd` — Windows `.cmd` wrapper for `cmd.exe`
- `install-autorun.cmd` — Windows Task Scheduler installer (at logon, every 5 min, at boot)
- `scripts/quick-set.mjs` — inline-cred one-shot pipeline runner
- `scripts/check-autonomous-ready.sh` — readiness check
- `scripts/trigger-autonomous-wire.sh` — fire GitHub workflow
- `scripts/trigger-full-pipeline.sh` — full local run

**Documentation**
- `docs/bank-wires-remediation-2026-07-26.md` — root cause + fix
- `docs/attijari-portal-submission-checklist-2026-07-26.md` — step-by-step portal UI walkthrough
- `docs/autonomous-pipeline-status-2026-07-26.md` — end-to-end status
- `docs/hands-free-wise-attijari.md` — Wise API path

### Fixed
- `scripts/poll-wise-bank-wire.mjs`, `scripts/confirm-bank-wire-receipt.mjs`,
  `scripts/process-pending-wires.mjs`, `scripts/auto-settle-bank-wire.mjs` —
  use row ObjectId `id` instead of `batch_id` for Base44 PUT (5 call sites)
- `scripts/auto-execute-wire.mjs` — fixed `headless` variable scoping in second launch
- `scripts/feed-attijari-watchdog.mjs` — fixed import paths for sync fs functions

### Changed
- `puppeteer-core` moved to `optionalDependencies` (npm install no longer fails if unreachable)
- `puppeteer` → `puppeteer-core` (uses system Chrome, no bundled download)

### Generated artifacts
- 4 SWIFT MT103 files: `settlements/bank_wires/mt103_BATCH_RECOVERY_BANK_WIRE_*.txt`
- 4 portal instructions: `exports/settlement/instructions/wire_BATCH_RECOVERY_BANK_WIRE_*.json`
- 6 wire packets (12 total): `exports/bank-wire/auto_wire_card_*.txt`, `auto_wire_instructions_*.txt`
- 2 portal screenshots: `exports/settlement/{bc-wire,at-repat}-*.png`

### Verified
- Chrome + puppeteer-core installed in sandbox, headless mode works
- Banking Circle portal reached, screenshot captured
- Attijari portal reached, WAF rejection captured (real cookies bypass needed)
- Full PowerShell deployment ran end-to-end with `pwsh 7.6.4`
- Watchdog restarted killed daemon within 30 seconds
- All 20 commits land cleanly on `port/remote-main-procurement`

## [2.0.0] - 2026-07-25 — "Banking Circle + Doomsday Vault"

- Banking Circle integration for automated EUR→MAD wires
- Doomsday vault + secure cloud upgrade
- Hands-free Wise owner settlement workflows
- Hardened live procurement tracking and receipt validation

## [1.0.0] - 2026-07-20 — "Initial autonomous procurement"

- Live ingestion for owner payout routes
- Ingest real PayPal revenue events
- LIVE_ONLY_PAYOUTS enforcement
- Audit live ops gaps and enable live procurement execution
