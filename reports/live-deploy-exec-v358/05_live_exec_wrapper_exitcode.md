# 05 — Live Exec Owner Hands-Free Wrapper LASTEXITCODE

> Scope: All 6 OWNER Routes Aggressive Mode (per user AskUserChoices confirmed). PowerShell NON-INTERACTIVE Non-Elevated scope — UAC elevation handled inside wrapper cmd if needed. No crash UAC sandbox Trae.

| Item | Value |
|---|---|
| Script appelé | `powershell -File scripts/start-owner-hands-free.ps1 -NonInteractive` |
| LASTEXITCODE | **99** |
| Status honnête | EXIT=99 DB_AUTH_FAIL (gates open G1 pass Neon creds refused — rotate DATABASE_URL pooled) |
| Stdout capture lines | 23 (first 16) |

```powershell
> [HANDS-FREE] T-0: autorotate pre-hook
> ========================================================================
> SPEC git-secrets-autorotate-autosync-autocoordinate v3.5.8 — ✅ PASS GrandTotal=23/26 threshold=21 buffer=2.0
> ========================================================================
> AC1 = 2/2
> AC2 = 2/2
> AC3 = 2/2
> AC4 = 2/2
> AC5 = 2/2
> AC6 = 2/2
> AC7 = 2/2
> AC8 = 1/2
> AC9 = 2/2
> AC10 = 2/2
> AC11 = 2/2
> AC12 = 1/2
```

### Stderr tail last 8 lines (safe):
> (vide)

### 8 Minimal Unblock maskSecret live env capture (0 leak len info only):
| Key | env value mask |
|---|---|
| `DATABASE_URL` | (EMPTY_PLACEHOLDER) |
| `LIVE_BANK_API` | (EMPTY_PLACEHOLDER) |
| `BINANCE_API_KEY` | (EMPTY_PLACEHOLDER) |
| `BINANCE_API_SECRET` | (EMPTY_PLACEHOLDER) |
| `CEX_DIRECT_DEPOSIT_ENABLED` | (EMPTY_PLACEHOLDER) |
| `RELEASE_AMOUNT_OVERRIDE_USD` | (EMPTY_PLACEHOLDER) |
| `OWNER_EXEC_UNLOCK` | (EMPTY_PLACEHOLDER) |
| `OWNER_HANDS_FREE_POLICY` | (EMPTY_PLACEHOLDER) |