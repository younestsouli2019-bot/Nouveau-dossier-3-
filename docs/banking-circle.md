# Banking Circle Integration

## Why
Automated EUR→MAD wires via API. Replaces manual Attijari portal flows with programmatic
initiation, status polling, and confirmation. Best-in-class for cross-border wires
into Morocco (Attijariwafa).

## What is Banking Circle
- Banking Circle S.A. — Luxembourg-regulated credit institution
- API for: payments, beneficiaries, FX, balances, statements
- Supports: EUR Cross-border SWIFT, EUR T2 (RTGS), EUR SEPA Instant, EUR SEPA SCT
- FX trades: 24/7 via API (EUR/MAD supported)
- EUR cross-border SWIFT cut-off: 16:00 CET
- EUR T2 RTGS cut-off: 16:15 CET
- EUR SEPA Instant: 24/7

## Apply
1. Visit https://www.bankingcircle.com/contact/
2. Submit application: business account, EUR/MAD wires, expected volume, source of funds
3. Complete KYC: company docs, beneficial owners, regulatory disclosures
4. Sign Master Service Agreement + Pricing Schedule
5. Request API access (sandbox first, then production)
6. Get OAuth2 client_credentials (client_id + client_secret)
7. Get account_id (your Banking Circle EUR account)
8. Pre-register Attijari as a beneficiary → get beneficiary_id

## Required GitHub Secrets
After approval, set:
- `BANKING_CIRCLE_CLIENT_ID` — OAuth2 client_id
- `BANKING_CIRCLE_CLIENT_SECRET` — OAuth2 client_secret
- `BANKING_CIRCLE_ACCOUNT_ID` — your Banking Circle EUR account
- `BANKING_CIRCLE_BENEFICIARY_ID` — pre-registered Attijari beneficiary
- `BANKING_CIRCLE_FX_PAIR` — default `EUR/MAD`
- `BANKING_CIRCLE_ENV` — `sandbox` (default) or `production`

## Files
- `swarm-overrides/scripts/banking-circle-procure.mjs` — diagnostic + application reminder
- `swarm-overrides/scripts/banking-circle-execute.mjs` — wire execution scaffolding
- `swarm-overrides/scripts/procurement-diagnose.mjs` — full 9-rail audit
- `swarm-overrides/scripts/procurement-auto-enable.mjs` — auto-enable when creds present

## API Endpoints (per https://developer.bankingcircle.com/)
- `POST /v1/auth/access_token` — OAuth2 client_credentials
- `GET /v1/accounts/{id}/balances` — get account balance
- `POST /v1/payments` — initiate wire
- `GET /v1/payments/{id}` — poll status
- `POST /v1/fx/trades` — book FX trade (EUR/MAD)
- `GET /v1/fx/quotes` — get FX quote
- `GET /v1/beneficiaries` — list beneficiaries

## Per Moroccan Office des Changes
- 30% mandatory conversion EUR→MAD (Décompte)
- 70% retention in foreign currency (Compte en Devises)
- Banking Circle supports automated conversion + cross-border routing
- Beneficiary bank: Attijariwafa `007810000448500030594182` / M TSOULI YOUNES
- Attijari SWIFT: BCMAMAMC

## Expected Timeline
- Account approval: 2-4 weeks
- API access provisioning: 1 week
- Sandbox testing: 1-2 weeks
- Production go-live: 1 week
- Total: 6-8 weeks from application to first live wire

## What This Unblocks
- Replace BANK_WIRE (Attijari) with BANKING_CIRCLE for EUR→MAD wires
- Real-time wire status via API (vs guessing)
- FX-locked rates at submission time
- Sub-second API for instant EUR→EUR (SEPA Instant 24/7)
- $999,326.14 in pending agent-swarm batches can route through this rail
