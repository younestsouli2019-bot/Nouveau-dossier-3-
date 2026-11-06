# Mission pack — Shopify revenue rail

**Status:** missions defined, not started. **Blocked on one human step: the merchant account.**
**Date:** 2026-11-06

## What an agent cannot do

Creating the store at `accounts.shopify.com` requires an email inbox you control, a password,
a store name, acceptance of Shopify's Terms of Service, and (before any payout) identity and
bank verification. Those are legal acts by the merchant, not deployable steps. No agent in this
swarm can or should create that account on your behalf.

Everything after the account exists is automatable, and that is what the missions below cover.

## Secrets this rail expects (names only — never commit values)

| Secret | Where used | Notes |
|---|---|---|
| `SHOPIFY_STORE_DOMAIN` | API + webhook routing | `<store>.myshopify.com` |
| `SHOPIFY_ADMIN_API_TOKEN` | Admin API reads/writes | custom app, scoped `read_orders`, `read_products` |
| `SHOPIFY_API_VERSION` | API path | pinned, e.g. `2026-01` |
| `SHOPIFY_WEBHOOK_SECRET` | webhook HMAC verify | from the webhook subscription |
| `RESEND_API_KEY` | buyer delivery | exists in sandbox; still missing from all Vercel projects |
| `SWARM_LIVE` | money-movement gate | already used by the payout engine |

## Missions

### M1 — Store bootstrap verification (agent: `tech`)
Given the store exists, prove the API surface works.
- **Acceptance:** `GET /admin/api/{version}/shop.json` returns the store name and currency;
  `GET /orders.json?status=any&limit=1` returns 200 (empty is fine).
- **Fail-closed:** missing token → abort, no retry storm.

### M2 — Product catalogue sync from the live catalog (agent: `tech`)
Map `data/rwc-catalog-live.json` to Shopify products (9 courses).
- **Acceptance:** every course has a Shopify product + variant; a round-trip read matches
  title, price and currency exactly; idempotent on re-run (match by SKU = course slug).
- **No fabrication:** a product that fails to create is reported, never assumed created.

### M3 — Webhook ingestion with HMAC verification (agent: `tech`)
`orders/paid` handler that verifies `X-Shopify-Hmac-Sha256` against
`SHOPIFY_WEBHOOK_SECRET`, then records a payment intent through the existing
`scripts/payment-intent-ledger.mjs` (same ledger the crypto chain writes to).
- **Acceptance:** valid HMAC → intent recorded once (idempotent on `order_id`);
  invalid HMAC → 401 and no ledger write; unknown topic → 200 ignore, no side effect.
- **Constraint:** the endpoint must be publicly reachable. `supply-chain-swarm` is currently
  SSO-gated (`ssoProtection: all`) and stale since 2026-09-01, so this mission cannot go live
  until the G1 secrets land. See issue #92.

### M4 — Buyer delivery (agent: `tech`)
On a PAID order: look up the buyer email, send course access via
`scripts/rwc-flush-pending-deliveries.mjs`, flip the row to SENT.
- **Acceptance:** one email per order, idempotent, no send when the row is already SENT.
- **Blocker:** `realworldcerts.com` is not verified in Resend, so buyer-facing mail 403s.
  Either verify the domain or send from the shared sender during testing.

### M5 — Payout routing to pre-set OWNER accounts (agent: `financial supervisor`)
Route net proceeds to the pre-set owner rails using the existing rail registry
(`bank_wire`, `paypal`, `crypto`) under `SWARM_LIVE` + per-rail credentials.
- **Reality check:** Stripe is unavailable for Morocco-based accounts, and Shopify Payments has
  limited availability there. Assume the store will settle to a bank account Shopify *does*
  support, with crypto as the fallback rail. Do not design around a gateway that cannot onboard.
- **Acceptance:** every settlement row carries a real external reference; no row reaches
  `RECONCILED` without one (the TRUTH-GUARDS already enforce this).
- **Fail-closed:** no live-authenticated rail → HOLD, log, do not fabricate a transfer.

### M6 — Base44 integration (agent: `tech`)
Two directions:
1. **Inbound to Base44:** paid Shopify orders become `CheckoutIntent` records (the entity the
   crypto chain already uses) so both rails share one buyer-intent store.
2. **Outbound from Base44:** publish the catalogue/pricing from the Base44 app to the store via
   the Admin API, so pricing has one source of truth.
- **Acceptance:** an order created in Shopify appears exactly once in `CheckoutIntent`;
  re-running the sync does not duplicate.

### M7 — Daily reconciliation (agent: `financial supervisor`)
Compare Shopify payouts against the ledger; surface drift.
- **Acceptance:** report lists payouts, matched intents, unmatched payouts, unmatched intents;
  drift counter exposed (`orchestrator_schema_drift_events_total` pattern already exists).

## Sequencing

M1 → M2 → M3 → M4 can run once the account exists and secrets are set.
M6 depends on M3 (webhook) for the inbound half.
M5 and M7 wait on a live-authenticated payout rail — today **none** is authenticated
(PayPal OAuth 401 `invalid_client`, Payoneer no credentials, crypto exchanges auth-fail,
bank in receipt-mode). Those are credential acquisitions, not code tasks.

## Standing rules that apply

- Payment/settlement artifacts stay out of public repos; buyer PII never lands in `data/out`.
- No payout without an external reference. UNKNOWN states are quarantined, never retried.
- The tick may only advance legal state-machine transitions; no cron-triggered auto-payouts.
