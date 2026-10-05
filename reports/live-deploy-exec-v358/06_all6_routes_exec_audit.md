# 06 — All 6 OWNER Routes Exec Audit (Aggressive Scope per user choice)

> Rail Class par preset. CredsMissingCount = nombre total de secrets + prérequis manquants. Row 6 R6: USDC Arbitrum L2 dry-run mathématique PUR SANS-DB SANS-APPEL-EXTERNE.

| Preset OWNER Route | Rail Class | Creds Missing Count | Status Honnête Fail-Closed |
|---|---|---:|---|
| R1 ATTIJARI_RIB182_SALAIRE (10% bucket) | Attijari Wafa PSD2 CIB SEPA Direct | 4 | ❌ SKIP (Attijari PSD2 OAuth2 + G2 DATABASE_URL Neon — 4/4 creds missing 0 rails réel aujourd'hui) |
| R2 ATTIJARI_RIB372_DETTE_CONTENTIEUX_018 (40% · 149k$) | Attijari Wafa PSD2 CIB virement | 4 | ❌ SKIP (Same 4 creds Attijari PSD2 + DATABASE_URL missing — SKIP cause R1 parent credential set absent) |
| R3 BC_LU24_RIB646_SOUVERAIN (30% bucket) | Banking Circle SDK SEPA-Instant EUR | 5 | ❌ SKIP (BC SDK user/pass/endpoint/PSK + G2 DATABASE_URL BIC routing 5/5 missing total) |
| R4 BC_LU24_RIB646_OPS (20% bucket) | Banking Circle SDK SEPA Standard | 5 | ❌ SKIP (Same 5 Banking Circle SDK secrets as R3 — shared 5/5 missing) |
| R5 PAYONEER_B2B_BUFFER | Payoneer B2B OAuth2 Mass Payout | 4 | ❌ SKIP (Payoneer client/id/secret/token 3/3 + PayPal CIP case ouvert MA-147672146951995880 total 4/4 missing) |
| R6 USDC_ARBITRUM_L2 Route #1 CEX Direct Deposit | L2_CRYPTO_DIRECT_CEX via Binance Spot Withdraw USDC.Arbitrum L2 bypass L1 | 5 | ✅ DRY_RUN_MATH_ELIGIBLE_ONLY (BC646 held=$63.67 USD ≥ RELEASE_OVERRIDE_USD=$60.00 → Δ=$3.67 USD. Wallet dest=0xA46225a984E2B2b5E5082E52AE8d8915A09FEFE7 checksum EIP55 valid. idempotencyKey=AUTO-RELEASE-BC646-20261005185339. ZERO real Binance API call. NO side effects. NO withdrawId réel. Status DRY_RUN_OK_NO_SIDE_EFFECTS_NO_REAL_CEX_CALL) |

### Dry-Run Math R6 précision:
```
HELD_BC646_USD           = $63.67
RELEASE_OVERRIDE_USD    = $60.00
RELEASE_MATH_VALID      = TRUE 63.67 >= 60.00 delta=3.67$ buffer
L2_WALLET_EIP55_DEST    = 0xA46225a984E2B2b5E5082E52AE8d8915A09FEFE7
IDEMPOTENCY_KEY         = AUTO-RELEASE-BC646-20261005185339
BYPASS_GAS_L1_BRIDGE    = TRUE (CEX DIRECT DEPOSIT USDC.ARBITRUM save $5-15 L1→L2 fee)
STATUS                  = DRY_RUN_OK_NO_SIDE_EFFECTS_NO_REAL_CEX_CALL
```