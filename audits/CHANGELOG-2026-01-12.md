Date: 2026-01-12

Scope: Autonomous crypto settlement, ledger safety, idempotency

Changes
- Added idempotency guard in crypto settlement run flow to prevent duplicate withdrawals on re-execution
- Introduced observation-only mode via `CRYPTO_MODE=observe` to poll provider/chain without initiating withdrawals
- Updated chain verification to return a pending flag for `not_found_yet` and map to `TX_BROADCASTED`
- Stopped storing full provider `raw_response` in ledger; persist minimal safe fields only
- Implemented atomic ledger writes to prevent partial/corrupt writes on crash
- Normalized exchange parameter handling and retained per-provider mapping (Binance `network`, Bybit `chain`)
- Configured `recvWindow=60000` and time-difference adjustment in CCXT exchange initialization
 
Payoneer Settlement
- Added CSV exporter script at scripts/export-payoneer-csv.mjs
- CSV columns now include recipient_email, recipient_name, payer_name, payer_email, payer_company, purpose, reference
- Added CLI args to override amount, payer info, and notes
- Created settlements/payoneer directory and wrote a receipt file for traceability
- Added settlement escalation planner script at scripts/settlement-escalation.mjs

Autonomous Owner Routes (Hands-Free)
- Added scripts/auto-settle-owner.mjs to generate Payoneer CSV from earnings automatically
- Integrated autoSettleOwnerPayoneer task into autonomous-daemon (window UTC 0–23, live mode env toggles)
- Added scripts/generate-paypalme-links.mjs (uses PAYPAL_NCP_PAYMENT_LINK or @handle)
- Added scripts/generate-bank-wire-csv.mjs for owner wire submissions from offline earnings
- Updated PayPal gateway to submit payouts via PayPal API (executePayout); falls back to NCP/invoice links if payouts not enabled
- Added scripts/micro-withdraw.mjs for bybit/bitget/mexc micro withdrawals, with instruction files when API is restricted

Environment Activation
- Enabled AUTONOMOUS_AUTO_SETTLE_OWNER_PAYONEER, AUTONOMOUS_PAYOUT_LIVE, window UTC start/end
- Set PAYPAL_NCP_PAYMENT_LINK and PAYPAL_ME_HANDLE to real owner values
- Created settlements/payoneer directory and wrote a receipt file for traceability

Operational Notes
- Observation mode upgrades ledger states independently without triggering new withdrawals
- Provider fallback stops after first accepted withdrawal; subsequent runs are observation-only
- Ledger writes are atomic and crash-consistent
