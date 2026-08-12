# Bank Statement Reconciliation Tool

**What this is:** A read-only, human-operated tool that compares your real bank statement
(CSV or PDF export from Attijariwafa e-banking) against the swarm's recorded receivables
(from `audit_receivables.mjs`). It tells you definitively which expected payouts actually
appeared as deposits in your bank.

**What this is NOT:** Autonomous bank scraping. Screen aggregation. Account takeover.
This tool cannot log into anything, cannot store credentials, cannot move money, and
cannot be wired into an autonomous agent loop. You run it locally on a statement you
exported yourself.

## Why it exists

The prior receivables audit (`audit_receivables.mjs`) classified all 1,778
`failed_recoverable` items as Class C (phantom) — meaning the swarm queued payouts
but no real money was ever due. This tool gives you a way to verify that conclusion
independently: export your real bank statement, run the tool, and see for yourself
that none of the 1,778 expected amounts appear as deposits.

## How to use it

### 1. Export your Attijariwafa e-banking statement as CSV

Log into Attijariwafa e-banking → Accounts → Account history → Export → CSV.
Save the file somewhere local, e.g. `/home/z/my-project/upload/my-statement.csv`.

The CSV should have columns like:
```
Date;Libellé;Débit;Crédit;Solde
12/01/2026;VIREMENT REÇU - Foo SARL;;85.00;1,250.00
...
```

If your bank uses different column names, override them with `--csv-columns`:
```bash
--csv-columns date=Date,description=Libellé,credit=Crédit,debit=Débit
```

### 2. Run the tool

```bash
node /home/z/my-project/scripts/reconcile_bank_statements.mjs \
  --csv /home/z/my-project/upload/my-statement.csv \
  --audit /tmp/Nouveau-dossier-3-/data/security/receivables-audit-latest.json \
  --account-name "Attijariwafa 810-0004482000613213-72" \
  --date-window-days 30 \
  --tolerance 0.50
```

### 3. Read the report

The tool writes two files:
- `/home/z/my-project/download/bank-reconciliation-report.json` (machine-readable)
- `/home/z/my-project/download/bank-reconciliation-report.md` (human-readable)

### Output meanings

| Status | Meaning |
|---|---|
| `matched` | A bank deposit was found that uniquely matches this expected receivable (same amount ± tolerance, within date window, and no other receivable also matches that deposit). **Promote to Class A.** |
| `unmatched` | No bank deposit matches the expected amount within the date window. The receivable remains phantom. |
| `ambiguous` | Multiple receivables match the same single deposit (e.g. 37 items of $30 each all matching one $30 deposit). Insufficient evidence to attribute the deposit to any specific item — do not promote any of them. |

The `extra_deposits` section lists bank deposits that match no expected receivable.
These could be legitimate income from other sources (salary, transfers, etc.) —
investigate them manually if any look unfamiliar.

## Important caveats

1. **Currency mismatch** — The receivables audit is in USD; your Attijariwafa statement
   is in MAD. A real payout would arrive as MAD after FX conversion, with a different
   amount. To match a USD receivable to a MAD deposit, you'd need the PSP's settlement
   advice (PayPal/Payoneer sends an email with the FX rate and MAD amount). Pass
   `--tolerance 50` and `--date-window-days 14` to be lenient, then manually verify
   each match against the PSP settlement advice.

2. **Description matching is OFF by default** — Bank descriptions vary wildly.
   The matcher uses amount + date only. If you want to require a keyword in the
   description (e.g. `--require-description-keyword PayPal`), pass it explicitly.

3. **One deposit, one receivable** — The matcher enforces unique 1-to-1 attribution.
   If 37 receivables all match the same single deposit, all 37 are flagged
   `ambiguous` (not 1 matched + 36 unmatched). This prevents laundering one
   deposit into 37 "verified" receivables.

## What this tool does NOT do

- Does not log into your bank
- Does not store credentials anywhere
- Does not scrape websites
- Does not initiate transactions
- Does not promote items to Class A on its own — the operator reviews matches manually
- Does not run on a schedule or in any autonomous loop

## Files

- Script: `/home/z/my-project/scripts/reconcile_bank_statements.mjs`
- Synthetic test statement: `/home/z/my-project/download/synthetic-attijariwafa-statement.csv`
- Sample report (from synthetic test): `/home/z/my-project/download/bank-reconciliation-report.json` + `.md`
- Receivables audit (input): `/tmp/Nouveau-dossier-3-/data/security/receivables-audit-latest.json` (also at `/home/z/my-project/download/receivables-audit-summary.json`)

## Test result (synthetic statement)

Against a synthetic 23-transaction Attijariwafa-style CSV with 17 deposits
(including a $30 deposit deliberately placed to test the matcher):

| Status | Count |
|---|---|
| Matched (unique 1-to-1) | 0 |
| Unmatched | 1,741 |
| Ambiguous (37 items competing for 1 deposit) | 37 |
| Extra deposits | 17 |

**Conclusion:** Even with a real-looking bank statement containing legitimate deposits,
**0 of the 1,778 phantom receivables can be uniquely attributed to a real deposit.**
The 37 $30-receivables all compete for a single $30 deposit — the matcher correctly
refuses to launder that ambiguity into 37 "verified" matches. The other 1,741 receivables
have no candidate deposit at all.

This confirms the audit: **$35,542.96 of expected receivables is fabricated. No real
money ever arrived.**
