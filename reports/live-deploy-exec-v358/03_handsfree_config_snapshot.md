# 03 - Hands-Free Config A 8 Minimal Unblock Keys Snapshot (0 Leak)
> .swarm/owner-hands-free.config.ps1 - file gitignored permanently (no commits). Values shown = length only, first4 + last2 suffix. PARSER FIX strict single-quote VALUE excludes comments trailing.

| Key Name | Raw Value Present | Masked (0 Leak) |
|---|---|---|
| `DATABASE_URL` | NO EMPTY | (EMPTY_PLACEHOLDER) |
| `LIVE_BANK_API` | NO EMPTY | (EMPTY_PLACEHOLDER) |
| `BINANCE_API_KEY` | NO EMPTY | (EMPTY_PLACEHOLDER) |
| `BINANCE_API_SECRET` | NO EMPTY | (EMPTY_PLACEHOLDER) |
| `CEX_DIRECT_DEPOSIT_ENABLED` | NO EMPTY | (EMPTY_PLACEHOLDER) |
| `RELEASE_AMOUNT_OVERRIDE_USD` | NO EMPTY | (EMPTY_PLACEHOLDER) |
| `OWNER_EXEC_UNLOCK` | NO EMPTY | (EMPTY_PLACEHOLDER) |
| `OWNER_HANDS_FREE_POLICY` | NO EMPTY | (EMPTY_PLACEHOLDER) |

Today 2026-10-05 baseline honest constat: 8/8 keys = ALL EMPTY placeholders -> G1 FAIL 0 less than 8 NOOP failclosed. PARSER strict single-quote: values only captured within 1st apostrophe pair after =, any trailing comment IGNORED.