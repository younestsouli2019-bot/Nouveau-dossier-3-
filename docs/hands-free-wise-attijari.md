# Hands-Free Wise -> Attijari Owner Bank Wire

This repo supports fully automated owner bank-wire settlement from the swarm ledger to the owner's Attijariwafa account through Wise.

## Recommended model

- Source ledger currency: `USD`
- Landing bank currency: `MAD`
- Destination bank country: `MA`
- Destination bank type: `SWIFT` recipient on Wise

This is the safest default for a Moroccan local destination account.

## What "hands-free" means here

The workflow is:

1. `auto-payout.mjs`
   - detects payable revenue
   - creates `PayoutBatch` records with `BANK_WIRE`

2. `auto-settle-bank-wire.mjs`
   - submits the bank wire through Wise
   - records `gateway_ref=wise:<transferId>`
   - moves Base44 `PayoutBatch.status` to `processing`

3. `poll-wise-bank-wire.mjs`
   - polls Wise transfer status
   - auto-promotes `processing -> completed` when Wise reports a final sent/completed state

So in this repo:

- `pending` = created, not submitted
- `processing` = submitted / in transit
- `completed` = confirmed by Wise completion polling
- `failed` = transfer failed or rejected

## Live-only revenue rule

This branch is now hardened for **live revenue only**:

- automatic payout creation does **not** trust `available_for_payout` alone
- `auto-payout.mjs` requires recent non-sample, non-cancelled `RevenueEvent` evidence
- if there are zero recent live events, it **skips** payout creation even when balances are large

This prevents old seeded balances, demo balances, or synthetic bookkeeping from producing real bank wires.

### Provenance markers

To ensure bank-wire execution only touches verified payout batches:

- auto-created live payout batches include `LIVE_EVIDENCE=...` in `notes`
- manual payout batches must include `REAL_REVENUE_REF=...` in `notes`
- `auto-settle-bank-wire.mjs` skips pending BANK_WIRE batches that do not contain one of those provenance markers

This protects against accidentally executing old or unverified pending batches.

## Required GitHub secrets

### Base44

- `BASE44_FLOW_API_KEY`
- `BASE44_SWARM_API_KEY`

### PayPal (live revenue ingestion)

To generate **real RevenueEvent evidence** (so payouts can be created from real income, not balances), the workflows ingest:

- PAID PayPal invoices
- completed PayPal credit transactions

- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`
- optional: `PAYPAL_API_BASE_URL` (default `https://api-m.paypal.com`)

### Plaid (optional live bank-credit ingestion)

If owner-route revenue evidence should also be pulled from linked bank accounts:

- `PLAID_CLIENT_ID`
- `PLAID_SECRET`
- `PLAID_ACCESS_TOKEN`
- optional: `PLAID_ENV`

### Wise

- `WISE_API_KEY`
- `WISE_PROFILE_ID`
- `WISE_ENVIRONMENT`
- `WISE_SOURCE_CURRENCY`

Recommended:

- `WISE_ENVIRONMENT=live`
- `WISE_SOURCE_CURRENCY=USD`

### Owner / Attijari

- `OWNER_BENEFICIARY_NAME`
- `OWNER_SWIFT_BIC`
- `OWNER_ACCOUNT_NUMBER`
- `OWNER_BANK_COUNTRY`
- `OWNER_BANK_CURRENCY`

Recommended:

- `OWNER_BANK_COUNTRY=MA`
- `OWNER_BANK_CURRENCY=MAD`

Optional fallbacks:

- `OWNER_SWIFT`
- `OWNER_IBAN`
- `OWNER_ROUTING_NUMBER`
- `OWNER_SORT_CODE`
- `OWNER_ACCOUNT_TYPE`

## Recipient mode resolution

The scripts choose recipient mode in this order:

1. `IBAN` for `EUR`
2. `SORT_CODE` for `GBP`
3. `SWIFT` for non-US bank accounts, including Morocco
4. `ABA` as US fallback

For Attijari / Morocco, the intended mode is:

- `OWNER_SWIFT_BIC` or `OWNER_SWIFT`
- `OWNER_ACCOUNT_NUMBER`
- `OWNER_BANK_COUNTRY=MA`
- `OWNER_BANK_CURRENCY=MAD`

## Workflows

### `auto-settle-all.yml`

Full revenue -> payout -> settlement -> poll -> reconciliation chain.

### `bank-wire-settle.yml`

Direct bank-wire settlement runner with preflight validation.

### `bank-wire-poll.yml`

Runs every 30 minutes:

- polls Wise completions
- validates whether any in-transit batch has been stuck for 2+ days

## Validation and operations scripts

### Preflight config check

```bash
node scripts/validate-wise-owner-config.mjs
```

Fails fast when secrets are missing or contradictory.

### Poll Wise completions

```bash
node scripts/poll-wise-bank-wire.mjs
```

### Check in-transit backlog

```bash
node scripts/validate-bank-wire-intransit.mjs --days=2
```

### Manual fallback confirmation

If a transfer must be confirmed from a statement instead of Wise polling:

```bash
node scripts/confirm-bank-wire-receipt.mjs --batch=<BATCH_ID> --receipt-ref=<REF> --received-by=<NAME> --notes="..."
```

## Security

- `bank-config.json` must stay local only
- the repo now ignores `bank-config.json`
- use `bank-config.example.json` only as a structure template
- never commit real owner bank coordinates

## Practical limitation

This automation uses Wise completion as the final automated confirmation signal.

That is the strongest hands-free signal available here, but it is still not the same as a direct Attijari statement API confirmation.

If a future bank statement integration is added, it should replace or augment `poll-wise-bank-wire.mjs`.
