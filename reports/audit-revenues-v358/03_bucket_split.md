# 03 — Ventilation BUCKETS Canoniques 10/40/30/20 — Audit v3.5.8

**Formule signataire Contentieux 018:**
- 10% Salaire → Attijari RIB182
- 40% Dette → Attijari RIB372
- 30% Réserves Souveraines → Banking Circle LU24 RIB646
- 20% Opérations Exécution → Banking Circle LU24 RIB646 (même compte)

## Input Total Available
De 02_ledger_derived.md → Σ 6 presets available: **$6728.77**

## 4 Buckets Canoniques Calcul (10+40+30+20 = 100%)

| Bucket Label | Compte Préétabli | % | Montant USD | Montant MAD (FX=10.00 fallback) |
|--------------|------------------|---|-------------|----------------------------------|
| SALAIRE_SIGNAIRE_10PCT | ATTIJARI_RIB182_SALAIRE | 10% | $672.88 | 6728.80 MAD |
| DETTE_REMBOURSEMENT_40PCT | ATTIJARI_RIB372_DETTE | 40% | $2691.51 | 26915.10 MAD |
| SOUVERAIN_RESERVE_30PCT | BC_LU24_RIB646_SOUVERAIN | 30% | $2018.63 | 20186.30 MAD |
| OPS_EXECUTION_20PCT | BC_LU24_RIB646_SOUVERAIN | 20% | $1345.75 | 13457.50 MAD |

## 6 Presets Mapping Remboursement Final

| Préétabli Label | Bucket | Montant USD |
|-----------------|--------|-------------|
| ATTIJARI_RIB182_SALAIRE | SALAIRE_SIGNAIRE_10PCT $10% | $672.88 |
| ATTIJARI_RIB372_DETTE | DETTE_REMBOURSEMENT_40PCT $40% | $2691.51 |
| BC_LU24_RIB646_SOUVERAIN | SOUVERAIN_RESERVE_30PCT $30% | $2018.63 |
| BC_LU24_RIB646_SOUVERAIN | OPS_EXECUTION_20PCT $20% | $1345.75 |
| PAYPAL_BUFFER_OPS | TAMPON_PAYPAL_OPS (tampon, 0% direct) | $0.00 (flux via buckets canoniques) |
| PAYONEER_B2B_FREELANCE | TAMPON_PAYONEER_B2B (tampon, 0% direct) | $0.00 (flux via buckets canoniques) |
| USDC_ARBITRUM_L2_WALLET | CEX_DIRECT_ARB_USDC (tampon, 0% direct) | $0.00 (flux via buckets canoniques) |

## Σ Check Arithmétique (Règle AC-3)
- Somme 4 buckets USD: **$6728.77**
- Total available (ref): **$6728.77**
- Δ = Σ 4 buckets − total (doit ≤ $0.01): **$0.00**
- **Verdict Σ check:** ✅ PASS — 0.10+0.40+0.30+0.20 = 1.00 × available exact ±0.01$

## Artefacts liés
- CSV détaillé 7 lignes: [03_bucket_rows.csv](./03_bucket_rows.csv)
- FX fallback = 1 USD = 10 MAD (valeur nominaliste — pas de taux réel utilisé NG2 No fabrication. Si taux réel connu, re-calc trivial.)
