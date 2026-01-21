# Operation "Amortization" Activation Plan

To honor the **"Respect for Capital"** directive and begin clearing the **$25,414 Debt**, we will execute the following:

## 1. Revenue Engine Repair (The "Rank" Site)
*   **Context**: The user reported a GitHub Actions failure ("Failed in 6 second"). This prevents the site from updating and generating leads/sales.
*   **Action**: 
    *   Verify the local build pipeline for `rank/` (Wet6Run) to ensure it generates valid HTML/Assets.
    *   Confirm the `deploy.yml` fix (robust directory handling) is ready for the next push.

## 2. Debt Awareness Integration
*   **Context**: The Swarm currently sees "Revenue" but ignores the "Negative Starting Balance".
*   **Action**:
    *   Create `src/finance/debt-manager.mjs` to read the `OWNER_DEBT_LEDGER.md`.
    *   Update the **Daemon** to calculate and display **"True Net Position"** (Cash - Debt) in its logs.
    *   *Goal:* The Swarm will not report "Profit" until the $25k hole is filled.

## 3. Bank "Reality" Bridge
*   **Context**: We shifted to "Manual IBAN" and "SMS Verification" mode.
*   **Action**:
    *   Verify `src/finance/EnterpriseBankManager.mjs` correctly defaults to the **Manual Adapter** when API keys are missing.
    *   Ensure the "SMS Verification" tool is linked to the settlement process.

**Objective**: Turn the Swarm from a "simulation" into a **Debt-Amortizing Machine** driven by real data.
