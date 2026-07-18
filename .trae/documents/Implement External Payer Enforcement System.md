# External Payer Enforcement Plan

I will implement a system to identify, track, and enforce payments from external payers (e.g., Affiliate Platforms, Client Accounts) to your OWNER accounts.

## 1. Identification
*   I will scan `settlements/` for metadata indicating "External Payers" (e.g., `payer_email`, `payer_company`).
*   I will create a registry of these entities in `data/external_payers_registry.json`.

## 2. Enforcement & Monitoring
*   **New Module:** I will create `src/finance/ExternalPayerEnforcer.mjs`.
    *   It will read pending `RevenueEvents` marked as `settled_externally_pending`.
    *   It will group them by Payer.
    *   It will generate "Demand Letters" (JSON/Text summaries) for overdue amounts.
*   **Tracking:** I will add a status field `enforcement_stage` (e.g., `pending`, `notified`, `overdue`, `collections`) to the local ledger.

## 3. Automation
*   I will update `autonomous-daemon.mjs` to run this enforcer periodically.
*   It will output a "Collections Report" to `reports/external_collections.md`.

Shall I proceed with building this enforcement module?