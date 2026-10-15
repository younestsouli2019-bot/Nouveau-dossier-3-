# T1 Detailed SKIP Reasons & Signataire Unblock Steps

## ATTIJARI_RIB182_SALAIRE
- **Type**: Banque MA PSD2 (MAD)
- **Account**: MA59…82 len=28
- **rail_ready reason**: ❌ SKIP: Missing Attijari Client ID + PSD2 OAuth code + G2 DATABASE_URL for BIC routing. Signataire paste creds in .swarm config.
- **proof_ready reason**: ❌ SKIP: ng2_phone_rule_no_fabrication_pending_real_pod_file

## ATTIJARI_RIB372_DETTE
- **Type**: Banque MA Attijari Wafa (MAD)
- **Account**: MA82…72 len=29
- **rail_ready reason**: ❌ SKIP: Same rail creds missing as ATTIJARI_RIB182 (Client ID / PSD2 / DB). Signataire unblock G2+Attijari secrets.
- **proof_ready reason**: ❌ SKIP: ng2_phone_rule_no_fabrication_pending_real_pod_file

## BC_LU24_RIB646_SOUVERAIN
- **Type**: Banque EU SEPA Inst SDK (USD/EUR)
- **Account**: LU24…46 len=20
- **rail_ready reason**: ❌ SKIP: Missing Banking Circle SDK user/pass/endpoint/PSK + G2 DATABASE_URL BIC lookups. Signataire inject BC secrets + G2.
- **proof_ready reason**: ❌ SKIP: ng2_phone_rule_no_fabrication_pending_real_pod_file

## BC_LU24_RIB646_OPERATIONS
- **Type**: Banque EU Banking Circle (USD/EUR)
- **Account**: LU24…NT len=16
- **rail_ready reason**: ❌ SKIP: Same BC SDK creds missing + G2 DB unblock. Signataire complete secrets config.
- **proof_ready reason**: ❌ SKIP: ng2_phone_rule_no_fabrication_pending_real_pod_file

## PAYONEER_B2B_BUFFER
- **Type**: Payoneer B2B Business USD (USD)
- **Account**: PAYO…ED len=23
- **rail_ready reason**: ❌ SKIP: Missing Payoneer Client ID / Secret / OAuth Access Token + PayPal CIP case unresolved. Signataire close CIP + Payoneer creds.
- **proof_ready reason**: ❌ SKIP: ng2_phone_rule_no_fabrication_pending_real_pod_file

## USDC_ARBITRUM_L2_WALLET
- **Type**: EVM L2 USDC CEX Direct Deposit (USDC (USD))
- **Account**: 0xA4…e7 len=42
- **rail_ready reason**: ✅ DRY-RUN OK (0 external calls, math-eligible only)
- **proof_ready reason**: ❌ SKIP: ng2_phone_rule_no_fabrication_pending_real_pod_file

