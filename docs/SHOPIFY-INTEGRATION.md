# Shopify Revenue Integration

Status: ingest code shipped and tested. **No store exists yet** — account
creation needs your email verification, your acceptance of Shopify's terms,
and a payment method for the plan, so it cannot be completed by an agent.

## What exists

| Piece | File | Behaviour |
|---|---|---|
| Admin GraphQL client | `src/lib/shopify/client.ts` | Pinned API version, 20s timeout, fails closed without credentials |
| Order ingestion | `src/lib/shopify/orders.ts` | Paid orders only; pagination; normalized total + currency |
| Sync CLI | `scripts/shopify-revenue-sync.ts` | Dry-run by default, `--apply` appends, idempotent per order id |
| Tests | `src/lib/__tests__/shopify-orders.test.ts` | 6 cases: mapping, unpaid/refunded exclusion, pagination, fail-closed |

## The Morocco constraint (same wall as Lemon Squeezy)

**Shopify Payments is not available to Moroccan-registered merchants.** You
must use a third-party gateway:

- **PayPal** — already configured in this project; funds settle to the PayPal
  balance, then move through the existing rails (Attijariwafa first).
- **Adyen / 2Checkout** — alternatives that do list Morocco.

Consequence: **Shopify Payouts will not apply.** Money never sits in Shopify,
so reconciliation must compare the gateway statement against this ledger, not
Shopify's payout report.

## Setup steps (yours, ~5 minutes)

1. Create the store at `accounts.shopify.com`.
2. Settings → Payments → activate PayPal (or Adyen).
3. Settings → Apps → develop an app → Admin API scopes: `read_orders`.
4. Install it and copy the Admin API access token.
5. Add `SHOPIFY_STORE_DOMAIN` and `SHOPIFY_ADMIN_TOKEN` to the secret store —
   **not** to a committed file. This repository has already leaked bank
   coordinates publicly once; a second leak would be expensive.

## Running the sync

```bash
npm run shopify:sync            # dry-run: shows new orders and revenue
npm run shopify:sync -- --apply # appends to data/out/shopify-revenue.ndjson
```

Exit codes: `0` ok, `3` not configured, `1` failure. Re-running cannot
double-count: each row carries `shopify:<order id>`.

## Autonomous revenue missions — the guardrails

Autonomy is granted in levels, and only the first is safe today:

- **L1 (enabled): observe and record.** Pull paid orders, write the ledger,
  report revenue. Read-only against Shopify.
- **L2 (needs your approval design): propose changes.** Agent drafts product
  descriptions, prices or discounts into a queue; a human applies them.
- **L3 (not recommended): autonomous pricing or listing.** A pricing agent
  with write access can destroy margin in an afternoon, and Shopify's API will
  happily execute it.

Hard rules regardless of level: no agent initiates payouts, no agent changes
prices without a recorded approval, every action lands in the audit log with
the order or product id it touched.

## Reconciliation

Daily: compare `shopify-revenue.ndjson` totals against the PayPal statement
for the same period. A mismatch means either an order state changed after
ingest (refund, chargeback) or a gateway fee assumption is wrong. Refunds are
**not** currently netted — the ledger sums paid orders only; add a refund sync
before treating the total as net revenue.

## Pricing the catalog

The price book is `rank/output/data/pricing/prices.json`: `currency: MAD`,
`minorUnits: 2`, entries shaped `{ "mode": "quote_required" | "fixed", "amountMinor": <minor units> }`.
The sync reads **`amountMinor`** — a book written with `amount` publishes nothing.

```bash
# stage a cohort (dry run, writes nothing)
node scripts/utils-price-generator.mjs --base-mad 4500 --limit 10
# commit it (writes a timestamped backup first)
node scripts/utils-price-generator.mjs --base-mad 4500 --limit 10 --apply
```

297 of 298 entries are `quote_required` and one is already fixed (PPL, 250 MAD),
so the store has exactly **one** sellable item today. The generator converts
quote leads by default; `--exclude-quote-required` opts out. `--apply` requires
`--approve-by`, and every run writes a timestamped backup.

### The currency decision that blocks Step 2

`shopify-catalog-sync.mjs` refuses to publish when the store currency differs
from the book's currency — a good guard, but it forces a choice:

- **Store MAD + PayPal**: PayPal does not support MAD as a transaction
  currency, so a MAD store with PayPal as sole gateway cannot complete checkout.
- **Store MAD + a MAD-capable gateway** (CMI/local acquirer): viable locally,
  weaker for international buyers.
- **Store USD/EUR + PayPal**: works, but the price book must then be
  denominated in that currency; Shopify Markets can display MAD equivalents.

Pick the gateway first, then set the book currency to match it. Do not run
`--apply` before that decision: a mismatched book makes the sync refuse, and
a matched one publishes at a price you may not have intended.
