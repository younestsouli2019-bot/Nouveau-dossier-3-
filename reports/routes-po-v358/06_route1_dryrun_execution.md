# T4 Dry-Run Route #1: BC646 Souverain → USDC Arbitrum L2 Wallet

| Param | Value |
|---|---|
| Source Held Balance (BC RIB646) | $63.67 USD |
| RELEASE_AMOUNT_OVERRIDE_USD | $60.00 USD |
| Δ (Held - Release) | $3.67 USD (buffer) |
| Release Eligible (held ≥ override) | ✅ TRUE |
| Resolve Rail Class | L2_CRYPTO_DIRECT_CEX |
| Preferred Rail (CEX DIRECT) | arbitrum |
| Destination Wallet (EIP-55) | 0xA46225a984E2B2b5E5082E52ae8d8915A09FEFE7 |
| Idempotency Key | `AUTO-RELEASE-BC646-20261005182147` |
| Real CEX/Binance API Calls | 0 |
| Final Status | **DRY_RUN_OK_NO_SIDE_EFFECTS_NO_REAL_CEX_CALL** |


## Important
- This is a **pure math SANS-DB SANS-SECRETS simulation**: no Binance withdraw was sent, no funds moved.
- To turn this into **EXEC RÉEL**, signataire must paste 8 secrets into .swarm config + G3 Binance KEY/SECRET (Spot Withdraw scope) + G4 UNLOCK ≥43 chars.
