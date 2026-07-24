# Live Revenue Ingestion (No Synthetic)

This branch enforces: **NO synthetic revenue, NO projected revenue, NO seed balances → payouts.**

## Rule

`auto-payout.mjs` will only create payout batches from **unbatched live RevenueEvent records** (externally verifiable cash events).

It will not create payouts based on `RevenueStream.available_for_payout` alone.

## Current ingestion: PayPal invoices (PAID only)

Workflow runs:

- `scripts/ingest-paypal-revenue-events.mjs`
  - calls live PayPal API
  - lists invoices
  - creates `RevenueEvent` only when invoice `status=PAID`

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

## Operational notes

- If there are **0 paid invoices**, ingestion creates 0 events and payouts will not be created.
- If there are paid invoices, payouts will be created only up to the sum of **unbatched paid invoices** (grouped per currency).

