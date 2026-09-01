# Payment Rails Integration

This documents the PayPal + Wise payment integration on the
`feature/paypal-wise-integration` branch.

## Overview

- `src/lib/axiosClient.ts` — shared HTTP client with a pluggable token hook,
  idempotency keys, and retry/backoff.
- `src/services/paypalService.ts` — PayPal OAuth, balance check, and idempotent
  payout batch + single-payout helpers.
- `src/services/wiseService.ts` — Wise OAuth, quote → recipient → transfer flow,
  confirm-gated (fail-closed), idempotent.

All rails are fail-closed by default: they refuse to move money unless the
caller explicitly opts in (`confirm` / `confirmedTransfer`).

## Security rules

- **Never commit secrets.** Read credentials from the environment in dev and
  from a secrets manager (Vault, AWS Secrets Manager, ...) in production.
- **Rotate OAuth tokens.** Both services cache tokens in memory with expiry;
  for horizontal scale-in/out use a shared short-lived token cache (Redis).
- **Enforce caps + human multi-sig** for high-value payouts at the caller level.
- All mutating calls carry an `Idempotency-Key` so retries cannot double-spend.

## PayPal

### Credentials (sandbox)

```
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
PAYPAL_MODE=sandbox        # or "live"
```

### Exercise

```
node --import tsx examples/paypal-run.mjs
```

- By default it dry-runs (OAuth + balance check only).
- Set `CREATE_PAYOUT=1` and `PAYPAL_RECIPIENT_EMAIL=sb-...@example.com`
  (sandbox) to submit an actual sandbox payout.

### API

- `getBalances()` — attempt account balances (may be unavailable per account).
- `createPayoutBatch(batchId, items, senderBatchHeader?)` — idempotent payout.
- `createSinglePayout(batchId, receiver, currency, value, note?)` — convenience.

## Wise

### Credentials (sandbox)

```
WISE_API_KEY=...                         # simplest: bearer API key
# or client-credentials:
# WISE_CLIENT_ID=...  WISE_CLIENT_SECRET=...
WISE_PROFILE_ID=...                      # personal/business profile id
```

### Flow

1. `getProfiles()` — resolve the profile id
2. `createRecipientAccount({ currency, type, accountHolderName, details })` — get `id`
3. `createQuote({ sourceCurrency, targetCurrency, amount, targetAccount })` — get `quoteUuid`
4. `createTransfer({ targetAccount, quoteUuid, amount, currency }, confirmedTransfer)` —
   **requires `confirmedTransfer === true`; this moves money**

### Note on the Attijari RIB

To send EUR → MAD to the local Attijari RIB, use `type: 'iban'` and provide the
RIB as `details.IBAN`. The Wise sandbox cannot reach real domestic MAD RIBs; use
sandbox account details when testing.

## Idempotency keys

`AxiosClient` generates `idemp-<ts>-<rand>` automatically and accepts a caller
`idempotencyKey`. Both services pass a stable business-derived key
(e.g. `paypal-payout-<batchId>`, `wise-transfer-<txn>`).

## Verification

- `npx tsc --noEmit -p tsconfig.json` — must pass.
- Run the examples in sandbox mode before enabling production credentials.