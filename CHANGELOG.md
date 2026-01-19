# Changelog

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
