# RealWorldCerts — Card Checkout (Stripe) + Auto-Delivery

## What is wired

- `POST /api/checkout/create` — single entry point for every method on `/checkout/start.html`:
  - `card` (default, preselected) → Stripe Checkout Session, buyer is redirected to `session.url`
  - `cmi` → fail-closed 503 until Attijari SimplePay credentials exist
  - `paypal` / `payoneer` / `crypto` / `bank` → redirect to the existing static instruction pages
  - Prices resolve **server-side**: flat intro price (default 19 USD) via `RWC_BASE_PRICE_USD`,
    per-slug overrides via `RWC_PRICE_OVERRIDES` (JSON: `{"slug":"29.99"}`). The client can never set an amount.
- `POST /api/webhooks/stripe` — signature-verified, 5-min replay window, idempotent by session id.
  On `checkout.session.completed` the order is appended to `data/out/course-orders.ndjson`
  and a receipt email is attempted.
- `GET /api/orders?limit=50` — owner view of the ledger (guard: `x-ops-secret` = `OPS_SECRET`).
- `scripts/rwc-checkout-pages.mjs` — static generator now writes a card-first method grid and
  `checkout/thanks.html` (Stripe `success_url` target). Regenerate + redeploy the static site after edits.
- `scripts/rwc-flush-pending-deliveries.mjs` — replays PENDING deliveries once a mail key exists.
- `scripts/test/rwc-flush-pending-deliveries.test.mjs` — integration suite (mock mail provider,
  temp ledger): `node scripts/test/rwc-flush-pending-deliveries.test.mjs` → 18 checks
  covering fail-closed, dry-run, live flush, idempotency, provider-500 and provider-outage.

## Fail-closed rules

- No `STRIPE_SECRET_KEY` → card checkout returns 503 with a buyer-friendly fallback message; other methods keep working.
- No `STRIPE_WEBHOOK_SECRET` → webhook returns 503 (Stripe retries). Unsigned payloads → 400, never processed.
- No `RESEND_API_KEY` → order recorded as `PENDING`, replayable; a payment is never lost to a missing mail key.
- No `OPS_SECRET` → `/api/orders` always 401.

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `STRIPE_SECRET_KEY` | API host | Enables card checkout (`sk_live_…` / `sk_test_…`) |
| `STRIPE_WEBHOOK_SECRET` | API host | Webhook signature verification (`whsec_…`) |
| `RESEND_API_KEY` | API host | Receipt email sending (`re_…`) |
| `RWC_RECEIPT_FROM` | API host | Optional; default `RealWorldCerts <billing@realworldcerts.com>` (must be a Resend-verified domain) |
| `RWC_BASE_PRICE_USD` | API host | Optional; default `19` |
| `RWC_PRICE_OVERRIDES` | API host | Optional JSON; per-slug prices |
| `RWC_SITE_ORIGIN` | API host | Optional; default `https://www.realworldcerts.com` |
| `RWC_API_BASE` | static generator | Checkout API base for `start.html` (default `https://swarm-ops-project.vercel.app`) |
| `OPS_SECRET` | API host | Guards `/api/orders` |

## Go-live checklist

1. Stripe account → take `sk_live` key and create a webhook endpoint for
   `checkout.session.completed` pointing at `https://<API-HOST>/api/webhooks/stripe` → note `whsec_…`.
2. Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (+ optionally `RESEND_API_KEY`, `OPS_SECRET`)
   in the API host's environment.
3. Deploy the API (this repo) and regenerate/redeploy the static site so `start.html` shows the card
   method first: `RWC_API_BASE=https://<API-HOST> node scripts/rwc-checkout-pages.mjs`.
4. Verify domain in Resend for `billing@realworldcerts.com` (or swap the provider by editing `src/lib/rwc-delivery.ts`).
5. Smoke test: buy the cheapest course in test mode, confirm the order appears in `/api/orders` and the receipt email arrives.
