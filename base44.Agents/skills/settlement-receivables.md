# Settlement & Class A Receivables

Purpose: gate all revenue settlement behind Class A receivable coverage, net eligible receivables, and route through configured payment rails.

## Rules
- Revenue-generating mission types (default: marketing, market_research, store_setup, financial_setup, content_creation; override via RECEIVABLES_REVENUE_TYPES) require a Class A receivable.
- Class A = reconciliation MATCHED + counterpartyAck + gatewayLedger + oracleConfirmed. Partial = Class B. Unmatched/quarantined = Class C.
- Non-Class-A revenue receivables are BLOCKED from settlement (no escrow release, no net settlement). Reclassify to A first.
- All payout destinations must exist in owner-truth.json allowedRecipients (SBDS-1.0, owner-only).
- Observe mode by default; SWARM_LIVE=true enables real fund movement.

## Commands
- `node src/settlement/settlement.mjs status` — pipeline + ledger + escrow + receivables by class
- `node src/settlement/settlement.mjs receivables-status` — receivable records by class
- `node src/settlement/settlement.mjs receivables-audit` — revenue missions missing Class A coverage (status must be ALL_REVENUE_MISSIONS_COVERED)
- `node src/settlement/settlement.mjs settle-revenue [rail]` — net eligible Class A per currency, submit to rail (default charipay)
- `node src/settlement/settlement.mjs <sahl|charipay|payzone|xs2a>-status` — rail config/dry-run/token/payments
- `node src/settlement/settlement.mjs payout <amount> [MAD] [destination]` — owner payout via rail
- `node src/settlement/settlement.mjs selftest` — end-to-end self test
- `node src/settlement/settlement.mjs escrow-release-drill` — escrow quorum release drill

## npm
- `npm run settlement:receivables:audit`, `settlement:revenue:settle`, `settlement:charipay:status`, `settlement:payzone:status`, `settlement:xs2a:status`, `settlement:receivables:status`, `vault:settlement-seal`, `vault:snapshot`, `vault:status`

## Rails
- Morocco: sahl, charipay, payzone (sandbox + prod base URLs, dry-run by default, whitelist-checked)
- EU SEPA: xs2a (adorsys XS2A open-banking-gateway style)
- Generic: ach, sepa, swift, usdc, eurc, ma_openbanking
- Rail env: `<RAIL>_API_URL[_SANDBOX]`, `<RAIL>_API_KEY`, `<RAIL>_CLIENT_ID`, `<RAIL>_CLIENT_SECRET`, `<RAIL>_DRY_RUN`

## Vault
- Settlement data (data/settlement incl. receivables.json) sealed via `vault:settlement-seal` (split-key 5 shares, 3 required; env DOOMSDAY_SHARE_1..5).
- Integrity: `node src/secure-cloud.mjs verify`, health: `node src/secure-cloud.mjs health`.
