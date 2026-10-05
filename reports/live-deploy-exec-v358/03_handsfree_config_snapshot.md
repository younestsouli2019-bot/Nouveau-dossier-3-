# 03 - Hands-Free Config A 8 Minimal Unblock Keys Snapshot (0 Leak)
> .swarm/owner-hands-free.config.ps1 - file gitignored permanently (no commits). Values shown = length only, first4 + last2 suffix. PARSER FIX strict single-quote VALUE excludes comments trailing.

| Key Name | Raw Value Present | Masked (0 Leak) |
|---|---|---|
| `DATABASE_URL` | YES len=122 | post….t len=122 |
| `LIVE_BANK_API` | YES len=4 | **** len=4 |
| `BINANCE_API_KEY` | YES len=64 | vpMP…yU len=64 |
| `BINANCE_API_SECRET` | YES len=64 | 5CMW…Bv len=64 |
| `CEX_DIRECT_DEPOSIT_ENABLED` | YES len=4 | **** len=4 |
| `RELEASE_AMOUNT_OVERRIDE_USD` | YES len=2 | ** len=2 |
| `OWNER_EXEC_UNLOCK` | YES len=56 | jSbe…yL len=56 |
| `OWNER_HANDS_FREE_POLICY` | YES len=4 | **** len=4 |

Today 2026-10-05 baseline honest constat: 8/8 keys = ALL EMPTY placeholders -> G1 FAIL 0 less than 8 NOOP failclosed. PARSER strict single-quote: values only captured within 1st apostrophe pair after =, any trailing comment IGNORED.