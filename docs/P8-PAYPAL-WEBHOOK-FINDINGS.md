# P8 — PayPal webhook: verification findings

**Date:** 2026-11-05 · **Issue:** #92 · **Status:** open, blocked on secrets

## Verdict

The webhook **code** is correct and fail-closed. The **deployment surface cannot receive a
webhook** on any host. The `503 webhook_not_configured` branch is not the defect — it never
fires, because no request reaches the application.

## Code (verified correct)

`src/app/api/webhooks/paypal/route.ts`

- Verifies the PayPal transmission signature via `/v1/notifications/verify-webhook-signature`
  before any fulfilment.
- Re-reads the order from the PayPal API instead of trusting the payload.
- Returns `503` when `PAYPAL_WEBHOOK_ID` or client credentials are absent (fail-closed).
- Returns `500` on fulfilment failure so PayPal retries; `fulfilPayPalOrder` is idempotent.
- `PAYPAL_WEBHOOK_ID`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` **are** set in both the
  `realworldcerts` and `supply-chain-swarm` Vercel projects.

## Live reachability (2026-11-05 01:04Z)

`POST /api/webhooks/paypal` with an invalid body, from the public internet:

| host | status | meaning |
|---|---|---|
| `www.realworldcerts.com` | 404 | static project (`outputDirectory=site/realworldcerts`), no `api/` dir |
| `supply-chain-swarm.vercel.app` | 401 | Vercel Deployment Protection (`ssoProtection: all`) |
| `swarm-ops-project.vercel.app` | 401 | same protection, enabled during the data-leak remediation |

Healthy status is **400 `invalid_json`** (reachable + configured).

**Impact:** this webhook is the backup fulfilment path for a buyer who pays and closes the tab.
While every host returns 404/401, that path is dead: payment succeeds, the course is never
delivered, and PayPal stops retrying. Silent revenue loss with no alarm.

## Three stacked causes

1. **Static/API split** — the branded domain is a pure static deployment. `site/realworldcerts/`
   has no `api/` directory, so `/api/*` is 404 by construction.
2. **Stale app build** — `supply-chain-swarm` last deployed 2026-09-01T03:33Z, predating both
   the webhook route and `51d25c2` (operator-auth middleware).
3. **Deploy gate** — every `deploy-vercel` run fails preflight:
   `G1 FAIL: only 2/8 unblock keys set` (missing `DATABASE_URL`, `LIVE_BANK_API`,
   `OWNER_EXEC_UNLOCK`, `OWNER_HANDS_FREE_POLICY`, `CEX_DIRECT_DEPOSIT_ENABLED`,
   `RELEASE_AMOUNT_OVERRIDE_USD`), exit 5. The gate is correct; it is also why nothing ships.

## Security note — do not disable protection yet

Setting `ssoProtection` to `preview` on `supply-chain-swarm` immediately exposed, as HTTP 200
with real data: `/api/owner-accounts` (7 accounts incl. `accountNumber`, `swiftCode`,
`walletAddress`), `/api/payout-items`, `/api/procurement`. Reverted within seconds; re-verified
`302`. **The SSO gate is load-bearing security** because the deployed build predates `51d25c2`.
Disable it only after a patched build is deployed and verified to return 401 on those routes.

## Fix order

1. Add the six missing repo secrets so `deploy-vercel` passes G1.
2. Verify the patched build returns **401** (not 200) on `/api/owner-accounts` with protection off.
3. Only then set `ssoProtection` to `preview` so PayPal can deliver.
4. Alternative: Vercel Protection Bypass for Automation, registering the webhook URL with
   `?x-vercel-protection-bypass=<secret>`. The bypass cannot be created via the API
   (`protectionBypass` → `should NOT have additional property`); it must be made in the dashboard.
5. Acceptance: `POST` invalid JSON → expect `400`.

## Related environment gaps

- `OPERATOR_TOKEN` absent in **all** projects — deploying `51d25c2` will return 401 to everyone,
  including the dashboard. Set it before that deploy.
- `RESEND_API_KEY` absent from all Vercel projects — buyer delivery email cannot send in production.

## Harness

`verify/verify-paypal-flow.sh` (9 sequential read-only phases). P8 is now a live reachability
probe across all hosts, not a static grep. No state changes, no money movement.
