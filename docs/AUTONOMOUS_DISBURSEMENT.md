# 🤖 Autonomous Disbursement — Hands-Free Pipeline

## Overview

The settlement-to-payout flow runs **autonomously on a schedule**. No manual action required.

```
Schedule fires (every 4h)
       │
       ▼
autoDisbursePipeline (Base44 backend function)
       │
       ├── Query SwarmTransaction where status = "executed"
       ├── Filter out already-disbursed (check SwarmLedger)
       ├── For each pending:
       │     ├── Recommend rail (PayPal for ≤$10k, Payoneer for ≤$5k)
       │     ├── Calculate fees (2% processing, min $0.30, max $100)
       │     ├── Create immutable ledger entry (SwarmLedger)
       │     ├── Update transaction status → "disbursed"
       │     └── Write audit log (SwarmAuditLog)
       │
       └── Return summary
       │
       ▼
Agent step — notify owner with summary
```

## Two Layers of Autonomy

### 1. Base44 Scheduled Workflow (cloud)

Fires every 4 hours from Base44 infrastructure. No server needed.

- **Workflow:** "Auto Disbursement Pipeline"
- **Schedule:** `0 */4 * * *` (every 4h, Africa/Casablanca timezone)
- **Backend function:** `autoDisbursePipeline`
- **Agent step:** sends summary to owner on completion

### 2. Local Daemon (optional redundancy)

For faster cycles or local control:

```bash
# Single run
node scripts/autonomous-disbursement-daemon.mjs

# Watch mode (every 4 hours)
node scripts/autonomous-disbursement-daemon.mjs --watch --interval=4h

# Production (pm2)
pm2 start scripts/autonomous-disbursement-daemon.mjs -- --watch --interval=4h
pm2 save
pm2 startup
```

## Pre-Set Owner Accounts

Sourced from existing repo settlement instructions — no manual credential entry.

| Account ID | Rail | Destination | Max Single | Daily Limit |
|-----------|------|-------------|-----------|------------|
| preset_paypal_001 | PayPal | younestsouli2019@gmail.com | $10,000 | $50,000 |
| preset_payoneer_001 | Payoneer | younestsouli2019@gmail.com | $5,000 | $20,000 |

To add Wise/crypto: add accounts to the `PRESET_ACCOUNTS` array in the backend function.

## Fee Structure

| Component | Rate |
|-----------|------|
| Processing fee | 2% (min $0.30, max $100) |
| Platform fee | 0% (owner is the platform) |

## What Happens Each Cycle

1. **Poll** — query all `SwarmTransaction` records with `status = "executed"`
2. **Dedupe** — check `SwarmLedger` for entries with `entry_type = "disbursement"` — skip those
3. **Route** — recommend best rail based on amount vs. account limits
4. **Calculate** — deduct processing fee from gross amount
5. **Ledger** — create immutable entry with balance_before/after
6. **Update** — mark transaction as `status = "disbursed"` with disbursement metadata
7. **Audit** — write `AUTO_DISBURSEMENT` event to `SwarmAuditLog`
8. **Notify** — agent step sends summary to owner

## Status Flow

```
SwarmTransaction.status:
  submitted → approved → executed → disbursed
                                    ↑
                              autoDisbursePipeline
                              fires here (every 4h)
```

## Monitoring

```bash
# Check recent disbursements
# Via Base44: read SwarmLedger where entry_type = "disbursement"

# Check audit log
# Via Base44: read SwarmAuditLog where event_type = "AUTO_DISBURSEMENT"

# Test the pipeline manually
curl -X POST https://superagent-d5a9f123.base44.app/functions/autoDisbursePipeline \
  -H "Content-Type: application/json" -d "{}"
```

---

*Autonomous. Scheduled. Hands-free. Set it and forget it.*
