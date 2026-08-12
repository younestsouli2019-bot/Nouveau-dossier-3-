# Receivables Audit Report — ChariBaaS Swarm

**Run ID:** `AUDIT_1785493783560`
**Audited at:** 2026-07-31
**Scope:** All 1,778 `failed_recoverable` PayoutItems in `.autonomous-offline-store.json`
**Repo:** `github.com/younestsouli2019-bot/Nouveau-dossier-3-`

## TL;DR

**Zero dollars is withdrawal-eligible.** All 1,778 failed_recoverable items ($35,542.96 USD) are
classified as **Class C (phantom)** — the payouts were queued by the swarm but no real money was
ever due. Paying any of them out would be fabrication.

The prior reconciliation (`RECONCILE_1785421102934`) was correct to flag these items as
`failed_recoverable` rather than `settled`. **It did not create $35K of recoverable cash.** It
flagged that the previous state was theater. This audit goes one level deeper and confirms
that there is also no underlying receivable to recover.

## Classification matrix

| Class | Definition | Count | Total USD |
|-------|------------|-------|-----------|
| A — withdrawal-eligible | Backed by a real settled merchant event AND a verified merchant identity | **0** | **$0.00** |
| B — plausible, unconfirmed | Has a plausible receivable but missing settlement proof or merchant identity | 0 | $0.00 |
| C — phantom | No backing evidence; paying out would be fabrication | **1,778** | **$35,542.96** |

## Why every item is Class C

Every PayoutItem links to its underlying earning via `revenue_event_id`. The 1,778 items
link to exactly 3 distinct values, and **none is a real settled merchant event**:

| `revenue_event_id` | Items | Total | Diagnosis |
|---|---|---|---|
| `rwc_SIM_1774902945454` | 1,704 | $34,062.96 | `rwc_SIM_*` prefix = simulated swarm webhook, **not** an external receipt |
| `"1"` | 37 | $370.00 | Bare CSV row index, not an earning ID |
| `"3"` | 37 | $1,110.00 | Bare CSV row index, not an earning ID |

## What about the 3 Earning records ($150)?

The store does contain 3 `Earning` records totaling $150 (`REV_1768225534247`,
`REV_1768225564250`, `REV_1768225594250`). However:

1. **None of them is linked** by any PayoutItem — none of the 1,778 items' `revenue_event_id`
   values match any `Earning.earning_id`. The $150 in earnings and the $35,542.96 in payouts
   are completely disconnected.
2. Even the $150 itself is **self-reported by the swarm** (`source: "swarm_revenue"`),
   self-invoiced by the owner (`payer_name: "Younes Tsouli"`, `payer_company: "Private"`),
   with no `settlement_id` and no external confirmation.

So even the $150 is not Class A — it's at most Class B (plausible but unconfirmed), and only
after the owner produces a real consulting contract, a real invoice from a real third-party
client, and proof that the client actually paid.

## Gateway evidence (corroborating)

All 1,713 parent PayoutBatches use `payout_method = "PLAID"` with
`gateway_ref = "FILE:plaid_<batch_id>.csv"`. That format is a **local CSV-file handoff
stub** — no Plaid API call, no SWIFT message, no PayPal payout, no on-chain transaction was
ever dispatched. This was already established by the prior reconciler; this audit confirms
the receivable side is equally hollow.

## Required action

1. **VOID all 1,778 Class C items** — they are not real receivables and must never be paid.
2. **Do not unfreeze the swarm.** `freeze.active = true` must remain until the entire
   payout queue is decommissioned or rebuilt against real receivables.
3. **Do not wire anything to the Attijariwafa accounts** listed in the uploaded RIBs.
   Doing so would convert fabricated ledger entries into real banked cash — that is
   fraud regardless of who owns the destination account.
4. If you believe *any* of the $150 in Earning records is legitimate, produce the
   underlying contract + invoice + client payment proof. Only then can those specific
   records be promoted to Class A and routed through a real payout rail.

## Files

- Full per-item audit: `/tmp/Nouveau-dossier-3-/data/security/receivables-audit-latest.json`
- Summary JSON (downloadable): `/home/z/my-project/download/receivables-audit-summary.json`
- This report: `/home/z/my-project/download/receivables-audit-report.md`
- Audit script (re-runnable): `/home/z/my-project/scripts/audit_receivables.mjs`
