# Token & Connector Revocation Checklist — R2 Directive (2026-10-06)

**Executed by the OWNER only.** No automation revokes credentials — this document
inventories every access token / API key / connector in the system so revocation
is total and ordered. Values are never stored here (names and locations only).

> Money-gate status at time of writing: **CLOSED** (`consensus_state.json`
> → `moneyOverridePasses: false`, 1 distinct voter < 2 required). No flow is
> live while you execute this checklist.

## 1. Third-party data / connector credentials (revoke FIRST)

| # | Credential | Location | Revoke at | Breaks if revoked | Reissue |
|---|---|---|---|---|---|
| 1 | Neon `DATABASE_URL` | `.env` (local), GitHub secret `DATABASE_URL`, Vercel env | Neon console → Roles/API keys → reset password | all DB audits, PO queues, tick reconciles | new connection string → update .env + GitHub secret + Vercel |
| 2 | Base44 `api_key` (app 689afeabf1db9c30efe0bd7e) | `Desktop/base44.txt`, GitHub secret `BASE44_API_KEY` | Base44 dashboard → app → API keys → revoke | swarm-coordination app writes (app currently empty) | new key → re-export `base44.txt` |
| 3 | GitHub Actions secrets (all) | repo → Settings → Secrets | per-secret "Update" (rotate value) or delete | see per-credential rows | rotate in same session, then re-run deploy |
| 4 | BINANCE `API_KEY`/`SECRET`/`ED25519_PRIVATE_KEY` | GitHub secrets | Binance → API Management → delete key | withdrawals (currently gated) | new key, IP-whitelist Actions runners is NOT possible — keep disabled |
| 5 | PayPal OAuth client | GitHub/env (`PAYPAL_*`) | PayPal developer dashboard → Live apps | payout rail (already failing 401) | new client id/secret after hardening |
| 6 | Wise / Banking Circle creds | env/secrets (`WISE_*`, `RAIL_*`) | provider dashboards | settlement pipeline (currently blocked) | reissue per rail |
| 7 | Attijari PSD2 / OAuth connectors | env (`ATTIJARI_*`) | bank's PSD2 portal + contact contentieux desk | PSD2 probes | re-enroll with certified e-signature |
| 8 | TON mnemonic + EVM private keys | `.keys/` (gitignored), env | rotate wallets: move balances to fresh addresses; old keys burned | wallet rails (balances currently 0) | new wallets → update `owner-routes.json` |
| 9 | SMTP creds (`SMTP_*`) | env | mailbox provider security page | escalation letter dispatch | app-password reissue |
| 10 | Vercel / Space-Z tokens | `.vercel`, Space-Z dashboard | dashboards → tokens → revoke | deploys (already severed at deploy hook) | new token + set `SPACEZ_DEPLOY_HOOK` secret |

## 2. Order of operations (R2 sovereignty protocol)

1. Freeze: stop all daemons (`STOP-SWARM.cmd`) — already dead since 2026-10-01 16:20 UTC, verify.
2. Rotate provider credentials (table above, top → bottom).
3. Re-pin trust anchors: new cert fingerprints → `audit/legal/certificates.json`.
4. Run `node scripts/legal-entity-audit.mjs` — every entity must re-verify under the new trust anchors; anything unverified stays REJECTED (fail-closed).
5. Run `node scripts/legal-quarantine-sweep.mjs` (dry, then `--apply`).
6. Re-arm infra: `DATABASE_URL`, `SPACEZ_DEPLOY_HOOK`, `PAYOUT_TICK_SECRET` → then redeploy Space-Z.

## 3. Non-negotiables

- Never paste secret values into tickets, commits, or chat — names only.
- The quarantined clone (`workspace-*.tar`, gitignored) contains leaked-secret
  history: treat every credential that EVER touched it as compromised (rotate regardless).
- After rotation, re-run the full gate: `npm run audit:all`.
