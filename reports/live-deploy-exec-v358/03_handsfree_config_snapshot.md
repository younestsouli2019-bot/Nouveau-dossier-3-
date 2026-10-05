# 03 — Hands-Free Config §A 8 Minimal Unblock Keys Snapshot (0 Leak)
> .swarm/owner-hands-free.config.ps1 — file gitignored permanently (no commits). Values shown = length only, first4 + last2 suffix.

| Key Name | Raw Value Present | Masked (0 Leak) |
|---|---|---|
| `DATABASE_URL` | NO EMPTY | (EMPTY_PLACEHOLDER) |
| `LIVE_BANK_API` | YES len=37 | '   …ue len=37 |
| `BINANCE_API_KEY` | NO EMPTY | (EMPTY_PLACEHOLDER) |
| `BINANCE_API_SECRET` | NO EMPTY | (EMPTY_PLACEHOLDER) |
| `CEX_DIRECT_DEPOSIT_ENABLED` | YES len=37 | '   …ue len=37 |
| `RELEASE_AMOUNT_OVERRIDE_USD` | YES len=35 | '   …60 len=35 |
| `OWNER_EXEC_UNLOCK` | YES len=75 | '   …\n len=75 |
| `OWNER_HANDS_FREE_POLICY` | YES len=37 | '   …ue len=37 |

⚠️ Today 2026-10-05 baseline honest constat: 8/8 keys = ALL EMPTY placeholders → G1 FAIL 0<8 NOOP failclosed.