# T4 Gate Matrix Snapshot (FAIL-CLOSED baseline)

| Gate ID | Description | Status | Detail |
|---|---|---|---|
| G1 | G1 ≥8 secrets present | 🔴 FAIL | 0/36 secrets injected. Need 8-item minimal unblock set in .swarm config. |
| G2 | G2 DATABASE_URL len≥120 Neon PROD pooled | 🔴 FAIL | DATABASE_URL length=0. Expected ≥120 chars (Neon pooled connection string). |
| G3 | G3 Binance Spot Withdraw KEY+SECRET len≥32 each | 🔴 FAIL | BINANCE_API_KEY + BINANCE_API_SECRET both missing. Required for CEX direct deposit rail. |
| G4 | G4 OWNER_EXEC_UNLOCK len≥43 high entropy | 🔴 FAIL | OWNER_EXEC_UNLOCK length=0. Expected ≥43 chars for live HMAC signing. |


## Conclusion
All 4 gates CLOSED → **0 rail réel exécuté**. Route #1 ci-dessous est un DRY-RUN mathématique SANS-APPEL-EXTERNE.
