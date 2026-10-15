# T1 OWNER Routes Inventory 6×3 Grid

| # | Preset Account ID | preset_ready | rail_ready | proof_ready |
|---|---|---|---|---|
| 1 | ATTIJARI_RIB182_SALAIRE | ✅ FALLBACK REGISTRY (hardcoded NG1 SANS-DB) | ❌ SKIP: Missing Attijari Client ID + PSD2 OAuth code + G2 DATABASE_URL for BIC routing. Signataire paste creds in .swarm config. | ❌ SKIP: ng2_phone_rule_no_fabrication_pending_real_pod_file |
| 2 | ATTIJARI_RIB372_DETTE | ✅ FALLBACK REGISTRY (hardcoded NG1 SANS-DB) | ❌ SKIP: Same rail creds missing as ATTIJARI_RIB182 (Client ID / PSD2 / DB). Signataire unblock G2+Attijari secrets. | ❌ SKIP: ng2_phone_rule_no_fabrication_pending_real_pod_file |
| 3 | BC_LU24_RIB646_SOUVERAIN | ✅ FALLBACK REGISTRY (hardcoded NG1 SANS-DB) | ❌ SKIP: Missing Banking Circle SDK user/pass/endpoint/PSK + G2 DATABASE_URL BIC lookups. Signataire inject BC secrets + G2. | ❌ SKIP: ng2_phone_rule_no_fabrication_pending_real_pod_file |
| 4 | BC_LU24_RIB646_OPERATIONS | ✅ FALLBACK REGISTRY (hardcoded NG1 SANS-DB) | ❌ SKIP: Same BC SDK creds missing + G2 DB unblock. Signataire complete secrets config. | ❌ SKIP: ng2_phone_rule_no_fabrication_pending_real_pod_file |
| 5 | PAYONEER_B2B_BUFFER | ✅ FALLBACK REGISTRY (hardcoded NG1 SANS-DB) | ❌ SKIP: Missing Payoneer Client ID / Secret / OAuth Access Token + PayPal CIP case unresolved. Signataire close CIP + Payoneer creds. | ❌ SKIP: ng2_phone_rule_no_fabrication_pending_real_pod_file |
| 6 | USDC_ARBITRUM_L2_WALLET | ✅ FALLBACK REGISTRY (hardcoded NG1 SANS-DB) | ✅ DRY-RUN OK (0 external calls, math-eligible only) | ❌ SKIP: ng2_phone_rule_no_fabrication_pending_real_pod_file |


## Constants Summary
- Dry-run candidate: Row 6 USDC_ARBITRUM_L2_WALLET
- L2 Wallet (EIP-55): 0xA46225a984E2B2b5E5082E52ae8d8915A09FEFE7
- Held BC646: $63.67 | Release Override: $60.00 | Δ: $3.67
