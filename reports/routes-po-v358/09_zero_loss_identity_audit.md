# T7 Zero-Loss Identity Guarantee (Pure deriveBalance)

## AC7: prev=this_run Identity (2 consecutive runs on identical dataset)

| Preset | runA.available USD | runB.available USD | Δ (A-B) | Identity Match? |
|---|---|---|---|---|
| ATTIJARI_RIB182_SALAIRE | $12500.00 | $12500.00 | $0.00 | ✅ YES |
| ATTIJARI_RIB372_DETTE | $-9600.00 | $-9600.00 | $0.00 | ✅ YES |
| BC_LU24_RIB646_SOUVERAIN | $63.67 | $63.67 | $0.00 | ✅ YES |
| BC_LU24_RIB646_OPERATIONS | $1140.00 | $1140.00 | $0.00 | ✅ YES |
| PAYONEER_B2B_BUFFER | $3450.25 | $3450.25 | $0.00 | ✅ YES |
| USDC_ARBITRUM_L2_WALLET | $0.00 | $0.00 | $0.00 | ✅ YES |


| Check | Result |
|---|---|
| AC7 Identity Δ Sum | $0.00 |
| AC7 Identity All Match? | ✅ 2/2 PASS |
| Bucket Split 10/40/30/20 Sum | 100.00% | ✅ PASS (100.00%) |
| Solvency (min available) | $-9600.00 | ❌ FAIL |


## Final AC7 Rubric Score: 2/2 PASS
