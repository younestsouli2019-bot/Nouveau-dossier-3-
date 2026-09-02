# Payment Rails Integration

This documents the PayPal + Wise payment integration (merged into `main` in
`81a0d32416` from `feature/paypal-wise-integration`).

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

## CLI runners (fail-closed)

Two safety-gated CLI entry points wire the services through TreasuryEdge-style
caps (per-txn < 5000 USD, daily < 10000 USD). They **dry-run by default** and only
move money with `--confirm` + real credentials.

- `scripts/wise-sample-workflow.mjs` — Wise EUR→MAD payout. `WISE_API_KEY` (or
  `WISE_CLIENT_ID`/`WISE_CLIENT_SECRET`), `WISE_RECIPIENT_RIB` or
  `WISE_RECIPIENT_ACCOUNT_ID` (opts: `WISE_SANDBOX=1`, `WISE_MODE=live`).
  ```
  node --import tsx scripts/wise-sample-workflow.mjs --dry-run --amount=1200
  node --import tsx scripts/wise-sample-workflow.mjs --confirm --amount=1200 --idem-key=<stable>
  ```
- `scripts/paypal-payout-workflow.mjs` — PayPal payout. Needs `PAYPAL_CLIENT_ID` +
  `PAYPAL_CLIENT_SECRET`, `PAYPAL_RECIPIENT_EMAIL` (opts: `PAYPAL_MODE=live`).
  ```
  node --import tsx scripts/paypal-payout-workflow.mjs --dry-run --amount=1
  node --import tsx scripts/paypal-payout-workflow.mjs --confirm --amount=1 --recipient=<email>
  ```

Both rely on the deterministic idempotency keys described below, so a retried
logical payout is deduplicated rather than double-issued.

## Idempotency keys

`AxiosClient` generates `idemp-<ts>-<rand>` automatically and accepts a caller
`idempotencyKey`. Both services pass a stable business-derived key
(e.g. `paypal-payout-<batchId>`, `wise-transfer-<txn>`).

## Verification

- `npx tsc --noEmit -p tsconfig.json` — must pass.
- Run the examples in sandbox mode before enabling production credentials.

## Decision support & safeguards (new)

Beyond the payout runners, the repo ships security/verification tooling that is
safe to run anywhere (no DB/network, no money moves):

- `npm run edge:plan` — `scripts/edge-plan-tool.mjs`. Builds a **real**
  `TreasuryEdge` and evaluates the full gate stack (per-txn cap, daily cap,
  velocity, multi-sig) for a hypothetical transfer **without moving money** —
  operator decision support before running a payout. Pass `--rail=wise|paypal`,
  `--amount=<n>`, `--counterparty=<id>`, `--currency=<ISO>`, `--confirm` (still
  never sends). Fails closed if the base URL is rejected by the SSRF guard.
- `npm run guard:selftest` — `scripts/url-guard-self-test.mjs`. 38-case SSRF
  regression test (IPv4/IPv6 classifiers, scheme/host static checks, and
  DNS-resolving cases).
- `npm run audit:truth` — `scripts/truth-invariant-audit.mjs`. Static truth
  invariants: no hardcoded secrets, no confirm-gate auto-submit bypass,
  SSRF guard wired into AxiosClient, reconciliation doc present + flags the
  external-supervisor figures unverified, no timestamp/random idempotency keys,
  no legacy `api.wise.com` refs.
- `npm run audit:all` — one-shot CI gate:
  `typecheck && audit:truth && guard:selftest`.

All of the above are purely read-only / dry-run: they never submit a transfer
and never require live credentials.