## Settlement Truth Audit Plan

You asked a critical question: **"How many REAL settlements happened?"**

To answer this with 100% integrity, I cannot just "guess." I must forensically audit the file system for **Proof of Payment** (CSVs, Logs, External IDs).

### 1. The Audit Script (`src/ops/audit-real-settlements.mjs`)
I will create a script that scans:
*   `settlements/payoneer/historical/*.csv` (Payoneer History)
*   `settlements/bank_wires/*.csv` (Bank Wire Instructions)
*   `data/financial/settlement_ledger.json` (Internal Ledger)

It will categorize every "Payout" into 3 buckets:
1.  **✅ CONFIRMED**: Has an External ID (e.g., `PAYO_...`) AND a file proof.
2.  **⚠️ PENDING**: Generated but no confirmation of receipt.
3.  **👻 PHANTOM**: Logged in DB but no file/external trace (The "Hidden Wallet" issue).

### 2. The Report (`docs/SETTLEMENT_TRUTH_REPORT.md`)
I will generate a human-readable report listing:
*   **Total Real Cash Sent**: $X,XXX.XX
*   **Total Pending**: $X,XXX.XX
*   **Phantom/Failed**: $X,XXX.XX
*   **Destinations**: Exactly which emails/IBANs were targeted.

### 3. Execution
I will run this immediately and present you with the **Hard Numbers**. No more simulations.

**Shall I proceed with the Forensic Audit?**
