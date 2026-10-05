# 08 — Zero-Loss deriveBalance Identity Guarantee (pure function)

> Méthode: 2 runs consécutifs `deriveBalance` pure fonction même dataset 6 presets. Si runA === runB sur 6/6 Δ=0 → score 2/2.

| Preset | Currency | Credit Seed (USD/MAD) | runA.available | runB.available | Δ A-B | Identity Match |
|---|---|---:|---:|---:|---:|---|
| ATTIJARI_RIB182_SALAIRE | MAD | 672.88 | 672.88 | 672.88 | 0.00 | ✅ IDENTICAL Δ=0 |
| ATTIJARI_RIB372_DETTE_018 | USD | 2691.51 | 2691.51 | 2691.51 | 0.00 | ✅ IDENTICAL Δ=0 |
| BC_LU24_RIB646_SOUVERAIN | USD | 2018.63 | 2018.63 | 2018.63 | 0.00 | ✅ IDENTICAL Δ=0 |
| BC_LU24_RIB646_OPS | USD | 1345.75 | 1345.75 | 1345.75 | 0.00 | ✅ IDENTICAL Δ=0 |
| PAYONEER_B2B_BUFFER | USD | 0.00 | 0.00 | 0.00 | 0.00 | ✅ IDENTICAL Δ=0 |
| USDC_ARBITRUM_L2_WALLET | USDC | 0.00 | 0.00 | 0.00 | 0.00 | ✅ IDENTICAL Δ=0 |

```
IDENTITY_PASS_6_6 = true (6/6)
BUCKET_SUM_100_PERCENT = 100.00% 2 décimaux exact
MIN_AVAILABLE_SOLVENCY_GE_0 = true min=0.00
```