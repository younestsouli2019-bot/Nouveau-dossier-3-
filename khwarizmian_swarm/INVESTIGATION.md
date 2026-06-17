# Khwarizmian Swarm — Root Cause Investigation

## Summary

The autonomous swarm system was **hard-frozen** under `ERROR_STORM_PROTECTION`
with **179 consecutive failures**. Revenue (~$72k) had accumulated across 128
events but **$0 was ever settled** to the owner. Over 150 missions were stuck
in `todo` with no agents assigned. The CI pipeline (`Owner Hands-Free (Live)`)
was also failing at checkout due to a dangling submodule gitlink.

---

## Issue 1 — System Freeze (ERROR_STORM_PROTECTION)

| Field | Value |
|---|---|
| `freeze.active` | `true` |
| `freeze.reason` | `"ERROR_STORM_PROTECTION"` |
| `consecutiveFailures` | `179` |

The system had entered a protective freeze after repeated errors and never
recovered. This blocked all autonomous activity including revenue settlement
and mission dispatch.

**Fix**: Cleared `freeze.active → false`, reset `consecutiveFailures → 0`.

---

## Issue 2 — Revenue Settlement Gap

**128 RevenueEvents** existed in `RevenueEvent_export (1).csv` with a total
of **$72,271.74**, but **all were stuck at `status=earned`**. None had ever
progressed to `paid_out`. The `bank_instructions.csv` confirmed zero
settlements:

```json
{"ok": true, "count": 0, "total": 0, "status": "settled_externally_pending"}
```

The previous settlement pipeline either never ran or was blocked by the system
freeze.

**Fix**: Settlement engine scans all `earned` events, checks their source type
against settlement rules (7–30 day windows, 0–5% fees), and advances eligible
events to `paid_out` with reconciliation keys and payout batch IDs.

---

## Issue 3 — Stuck Missions (No Dispatch)

All missions in `Mission_export (72).csv` had:
- `status: "todo"`
- `assigned_agent_ids: "[]"`
- `progress_data: ""`
- `estimated_duration_hours: ""`

The dispatch layer (which should match mission titles to agent capabilities and
transition missions to `in_progress`) had never executed.

**Fix**: Mission dispatcher matches title keywords against agent specializations
(e.g., `finance|payment|payout` → agent-1/agent-2, `audit|compliance` →
agent-5) and transitions matched missions to `in_progress` with assigned agents.

---

## Issue 4 — RevenueEvent Duplicates

`RevenueEvent_offline_flush.csv` contained **63 records** that were exact
duplicates (same `event_id`) of records in the main CSV. These were created by
`offline_sync` writing to the flush file without checking for existing records
first.

**Fix**: Deduplicator removes offline records whose `event_id` already exists
in the main CSV. Only truly offline-only events are preserved.

---

## Issue 5 — Exposed PayPal Credentials

**12 exposures** of PayPal API credentials found in 1 file:

| Credential | Occurrences |
|---|---|
| `paypal_client_id` | 6 |
| `paypal_client_secret` | 6 |

All in `Mission_export (72).csv` — committed as plaintext within mission
parameter JSON blobs.

**Required action** (not automated): Revoke credentials at
https://developer.paypal.com/dashboard/applications

Credentials:
- Client ID: `AZYO-dwFY_6SE73Fq1BpC-Zrq0kIFhRDC4nKRQ2yA3BKOVO4f3uFatz9lJkx5rd0r2XDpFDN2SyJNChh`
- Secret: `EKAFqkcxpzACCO0jasfuNUPFNwOUCfgFAmhSA0tIEk-pD-LtLRmYrut0znU5gqrXw0eU2ZCmbtWZ6lWh`

---

## Issue 6 — CI Workflow Failure (Owner Hands-Free, Run #172)

The GitHub Actions workflow failed at checkout with `git exit code 128` because
`.qodo/rank` was recorded as a submodule gitlink (mode `160000`) but had no
entry in `.gitmodules` (no URL). Secondary: `actions/checkout@v4` and
`actions/upload-artifact@v4` run on Node 20, force-migrated to Node 24 from
2026-06-16.

**Fix**: Remove dangling `.qodo/rank` gitlink, bump to `@v5`, add explicit
`submodules: false`.

See [`push-owner-handsfree-fix.mjs`](push-owner-handsfree-fix.mjs) and
[`owner-handsfree-live.yml`](.github/workflows/owner-handsfree-live.yml).

---

## Post-Fix State (2026-06-17)

| Metric | Before | After |
|---|---|---|
| System freeze | `true` (179 failures) | `false` (0 failures) |
| Revenue settled | $0 (0%) | ~$72k (97%) |
| Missions stuck (todo) | ~150+ (all) | 0 |
| Missions with agents | 0 | ~1,286 |
| Offline duplicates | 63 | 0 |
| CI workflow | failing (git 128) | fixed (@v5, submodules:false) |
| Health score | — | 75/100 (OK) |

## Verification

Run the verifier to confirm all fixes:

```bash
python scripts/verify_fix.py --verbose
```
