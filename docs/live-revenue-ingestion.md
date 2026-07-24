# Live Revenue Ingestion (No Synthetic)

This branch enforces: **NO synthetic revenue, NO projected revenue, NO seed balances → payouts.**

## Rule

`auto-payout.mjs` will only create payout batches from **unbatched live RevenueEvent records** (externally verifiable cash events).

It will not create payouts based on `RevenueStream.available_for_payout` alone.

## Current live ingestion modules

### 1. PayPal invoices (PAID only)

Script:

- `scripts/ingest-paypal-revenue-events.mjs`
  - calls live PayPal API
  - lists invoices
  - creates `RevenueEvent` only when invoice `status=PAID`

### 2. PayPal completed credit transactions

Script:

- `scripts/ingest-paypal-transactions.mjs`
  - calls PayPal transaction reporting API
  - ingests only completed credit-like transactions
  - skips duplicates by `external_id`

### 3. Wise balance credits

Script:

- `scripts/ingest-wise-balance-credits.mjs`
  - calls live Wise balance statement APIs
  - ingests incoming credit rows as `RevenueEvent`
  - intended for `BANK_WIRE` / `WISE` owner routes

### 4. Plaid bank credits

Script:

- `scripts/ingest-plaid-bank-credits.mjs`
  - calls live Plaid transactions API
  - ingests inbound/credit bank transactions as `RevenueEvent`
  - intended for `PLAID` owner routes

### Orchestrator

- `scripts/ingest-owner-route-revenue.mjs`
  - runs all configured provider ingestors
  - skips providers with missing credentials instead of failing the whole job

## Current gap

`PAYONEER` remains a manual/audited route in this branch.

There is currently no existing live Payoneer API connector in this repo, so no automated Payoneer ingestion module was added blindly.
Manual PAYONEER payouts are still constrained by:

- `REVENUE_REFERENCE`
- `MANUAL_REASON`

and therefore cannot bypass the real-income audit trail.

These events have:

- `provider=paypal`
- `event_type=invoice_paid`
- `external_id=paypal:invoice:<id>`
- `status=paid`
- `payout_status=unbatched`

## Idempotency

Ingestion uses `external_id` and skips if already present.

Payout creation marks revenue events:

- `payout_status=batched`
- `payout_batch_id=<batch>`

So the same paid invoice cannot be paid out twice.

## Required GitHub secrets

- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`
- `BASE44_SWARM_API_KEY`

Optional:

- `PAYPAL_API_BASE_URL` (default `https://api-m.paypal.com`)

For Wise route ingestion:

- `WISE_API_KEY`
- `WISE_PROFILE_ID`
- `WISE_ENVIRONMENT`

For Plaid route ingestion:

- `PLAID_CLIENT_ID`
- `PLAID_SECRET`
- `PLAID_ACCESS_TOKEN`
- optional: `PLAID_ENV`

## Operational notes

- If there are **0 paid invoices**, ingestion creates 0 events and payouts will not be created.
- If there are **0 live credits/events** across configured providers, payouts will not be created.
- If there are live events, payouts will be created only up to the sum of **unbatched live events** (grouped per currency).
- Provider modules without credentials are skipped cleanly.
