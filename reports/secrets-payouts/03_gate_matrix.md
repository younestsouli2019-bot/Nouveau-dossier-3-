# T4 — Gate Matrix G1..G4 (Fail-Closed Doctrine)

Generated: 2026-10-05T17:31:12.107Z

| Gate | Boolean | Raison détaillée | Action |
|---|---|---|---|
| G1 | ❌ FAIL | seulement 0 / 8 chargés, attendu ≥ 8 secrets signataire pour minimal unblock set | STOP if required |
| G2 | ❌ FAIL | pas de DATABASE_URL injecté ou len=0 < 120 (attendu Neon pooled URL ≈ len=122) | STOP if required |
| G3 | ❌ FAIL | BINANCE_API_KEY len=0 / BINANCE_API_SECRET len=0 check ≥32 FAIL (Spot Withdraw perm absent) | STOP if required |
| G4 | ❌ FAIL | OWNER_EXEC_UNLOCK len=0 < 43 — minimum HMAC 43 chars for OWNER_EXEC_UNLOCK live signing fail | STOP if required |
| **ALL_GATES** | **❌ ALL BLOCKED — FAIL-CLOSED** | **FAIL-CLOSED NOOP 0 rail 0 CEX call 0 DB write — aucun appel script autorun/rail n'est émis (gates < 4/4)** | **NOOP exit 2** |

---

### Next Steps Signataire (si ALL_GATES=FAIL — blocage attendu aujourd'hui):

1. Ouvrir `scripts/run-live-crypto-po.ps1` éditeur.
2. Section `$SecretsToInject = [ordered]@{...}` lignes 63..111: remplacer les `$null` par les **8 valeurs vraies** minimal unblock set:
   - `DATABASE_URL` (len=122 Neon Postgres pooled PROD)
   - `LIVE_BANK_API = true`
   - `BINANCE_API_KEY` len≥32 (Spot Withdraw perm)
   - `BINANCE_API_SECRET` len≥32 (matching HMAC/Ed25519)
   - `OWNER_EXEC_UNLOCK` len≥43 chars high-entropy
   - `OWNER_HANDS_FREE_POLICY = true`
   - `CEX_DIRECT_DEPOSIT_ENABLED = true` (AUTO réseau → ARBITRUM, pas BSC)
   - `RELEASE_AMOUNT_OVERRIDE_USD = 60` (libère BC646 held=$63.67 malgré <$120 default)
3. Sauvegarder puis exécuter live: `powershell -ExecutionPolicy Bypass -NoProfile -File scripts\run-live-crypto-po.ps1 -Verbose`
