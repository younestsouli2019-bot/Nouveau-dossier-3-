# T5 3-Way Grid Refresh (Preset × Rail × Proof Readiness)

| Preset Account | preset_ready | rail_ready | proof_ready |
|---|---|---|---|
| ATTIJARI RIB182 SALAIRE (10% bucket) | ✅ FALLBACK REGISTRY (hardcoded NG1 SANS-DB) | ❌ SKIP: Missing Attijari Client ID + PSD2 OAuth code + G2 DATABASE_URL for BIC routing. Signataire paste creds in .swarm config. | ❌ SKIP: ng2_phone_rule_no_fabrication_pending_real_pod_file |
| ATTIJARI RIB372 DETTE CONTENTIEUX 018 (40% bucket 149kUSD) | ✅ FALLBACK REGISTRY (hardcoded NG1 SANS-DB) | ❌ SKIP: Same rail creds missing as ATTIJARI_RIB182 (Client ID / PSD2 / DB). Signataire unblock G2+Attijari secrets. | ❌ SKIP: ng2_phone_rule_no_fabrication_pending_real_pod_file |
| BANKING CIRCLE LU24 RIB646 SOUVERAIN (30% bucket) | ✅ FALLBACK REGISTRY (hardcoded NG1 SANS-DB) | ❌ SKIP: Missing Banking Circle SDK user/pass/endpoint/PSK + G2 DATABASE_URL BIC lookups. Signataire inject BC secrets + G2. | ❌ SKIP: ng2_phone_rule_no_fabrication_pending_real_pod_file |
| BANKING CIRCLE LU24 OPS (20% bucket runtime) | ✅ FALLBACK REGISTRY (hardcoded NG1 SANS-DB) | ❌ SKIP: Same BC SDK creds missing + G2 DB unblock. Signataire complete secrets config. | ❌ SKIP: ng2_phone_rule_no_fabrication_pending_real_pod_file |
| PAYONEER B2B PROCUREMENT BUFFER (PO achats MA) | ✅ FALLBACK REGISTRY (hardcoded NG1 SANS-DB) | ❌ SKIP: Missing Payoneer Client ID / Secret / OAuth Access Token + PayPal CIP case unresolved. Signataire close CIP + Payoneer creds. | ❌ SKIP: ng2_phone_rule_no_fabrication_pending_real_pod_file |
| USDC ARBITRUM L2 WALLET CEX DIRECT BYPASS L1 | ✅ FALLBACK REGISTRY (hardcoded NG1 SANS-DB) | ✅ DRY-RUN OK (math-eligible, 0 real CEX call) | ❌ SKIP: ng2_phone_rule_no_fabrication_pending_real_pod_file |


## Legend
- ✅ = Ready / DRY-RUN OK
- ❌ SKIP = Blocked (missing creds / NG2 Phone Rule pending real files)
- NG2 Phone Rule Permanent: proof_ready stays ❌ until a REAL `POD:<CARRIER>-sha256:<64hex>.json` file exists in `out/received/`.
