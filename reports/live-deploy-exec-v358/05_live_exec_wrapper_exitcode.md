# 05 — Live Exec Owner Hands-Free Wrapper LASTEXITCODE

> Scope: All 6 OWNER Routes Aggressive Mode (per user AskUserChoices confirmed). PowerShell NON-INTERACTIVE Non-Elevated scope — UAC elevation handled inside wrapper cmd if needed. No crash UAC sandbox Trae.

| Item | Value |
|---|---|
| Script appelé | `powershell -File scripts/start-owner-hands-free.ps1 -NonInteractive` |
| LASTEXITCODE | **5** |
| Status honnête | EXIT=5 FAIL_CLOSED_NOOP ✅ (0<8 secrets gates, 0 rails, 0 payout, 0 Binance call) |
| Stdout capture lines | 14 (first 16) |

```powershell
> [HANDS-FREE] START owner-hands-free v3.5.8
> [HANDS-FREE]   ROOT       = C:\Users\Dell\Downloads\Nouveau dossier (3)
> [HANDS-FREE]   CONFIG     = C:\Users\Dell\Downloads\Nouveau dossier (3)\.swarm\owner-hands-free.config.ps1
> [HANDS-FREE]   WRAPPER    = C:\Users\Dell\Downloads\Nouveau dossier (3)\scripts\run-live-crypto-po.ps1
> [HANDS-FREE] T2-8 8-unblock: present=0/8
> - DATABASE_URL = <empty len=0>  [MISSING]
> - LIVE_BANK_API = <empty len=0>  [MISSING]
> - BINANCE_API_KEY = <empty len=0>  [MISSING]
> - BINANCE_API_SECRET = <empty len=0>  [MISSING]
> - OWNER_EXEC_UNLOCK = <empty len=0>  [MISSING]
> - OWNER_HANDS_FREE_POLICY = <empty len=0>  [MISSING]
> - CEX_DIRECT_DEPOSIT_ENABLED = <empty len=0>  [MISSING]
> - RELEASE_AMOUNT_OVERRIDE_USD = <empty len=0>  [MISSING]
> FAIL-CLOSED exit=5 -> [T2-8] Minimal 8-unblock count=0<8. 8 requis: 1)DATABASE_URL len>=122 2)LIVE_BANK_API=true 3)BINANCE_API_KEY len>=32 4)BINANCE_API_SECRET len>=32 5)OWNER_EXEC_UNLOCK len>=43 6)OWNER_HANDS_FREE_POLICY=true 7)CEX_DIRECT_DEPOSIT_ENABLED=true 8)RELEASE_AMOUNT_OVERRIDE_USD=60. MANQUANTS: DATABASE_URL, LIVE_BANK_API, BINANCE_API_KEY, BINANCE_API_SECRET, OWNER_EXEC_UNLOCK, OWNER_HANDS_FREE_POLICY, CEX_DIRECT_DEPOSIT_ENABLED, RELEASE_AMOUNT_OVERRIDE_USD.
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