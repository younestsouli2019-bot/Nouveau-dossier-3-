# 04 — Gate Matrix G1..G4 Honest Audit (Fail-Closed Permanent)

| Gate ID | Description | Status | Detail (≥50 chars explanation) |
|---|---|---|---|
| G1 | ≥8 secrets §A injected (out of 36 ordered) | FAIL | 🔴 FAIL 0/36 keys filled .swarm/owner-hands-free.config.ps1 §A 36 ordered placeholders ALL empty → threshold 8 min FAIL_CLOSED NOOP 0 rails exécutés |
| G2 | DATABASE_URL Neon PROD pooled len≥120 characters | FAIL | 🔴 FAIL len=0 empty. Expected Neon PROD pooled URL format postgres://user:pass@ep-XXXX-pooled-XXXX.us-east-2.aws.neon.tech/main?sslmode=require options=project=XXXX len≈122 attendue |
| G3 | Binance KEY+SECRET len≥32 each Spot Withdraw dual scope IP whitelist | FAIL | 🔴 FAIL KEY len=0 SECRET len=0. Expected len≥32 chacun HMAC dual scope Spot Withdraw + Wallet Status + IP whitelist 45.155.0.0/16 configured in Binance API Management Console |
| G4 | OWNER_EXEC_UNLOCK HMAC signing key len≥43 high-entropy | PASS | ✅ len=75 |

## Resultat combiné aujourd'hui:
```
ALL_GATES_CLOSED = FALSE (partial gates open)
wrapper_exec_mode = FAIL_CLOSED_NOOP
```