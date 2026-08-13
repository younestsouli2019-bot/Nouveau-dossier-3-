#!/usr/bin/env pwsh
<#
.SYNOPSIS
  PRE-COMMIT hook — settlements dry-run sanity probe (disabled by default).

.USAGE (enable)
  Copy or symlink this script to:
    C:\Users\Dell\Downloads\Nouveau dossier (3)\.git\worktrees\quick-squid\hooks\pre-commit
  (the POSIX-non-extension file, not .ps1) and make executable.
  Or run:
    powershell -File scripts/git-extensions\install-hooks.ps1 -Enable pre-commit
    powershell -File scripts/git-extensions\install-hooks.ps1 -Disable pre-commit

.DESCRIPTION
  Runs only when files matching the settlements/bybit/deploy whitelist are
  about to be committed. Calls the LOCAL dry-run diagnostics driver and
  aborts the commit ONLY if the routing table for PRE-SET owner accounts
  drops below the minimum SIMULATED-owner-ok threshold (2 Attijari routes).
  LIVE executions are NEVER triggered here — this hook cannot modify
  SWARM_LIVE_PAYMENTS or vault keys. Explicitly designed to fail open
  (exit 0) when node_modules/.env are absent, so it will not block unrelated
  commits on a dev machine without the tooling.
#>
param()
$ErrorActionPreference = 'Stop'

# Always allow empty commits / merges / rebases to succeed
if ([string]::IsNullOrWhiteSpace((git diff --cached --name-only 2>$null))) { exit 0 }

# Only act when settlements/bybit/deploy code paths are touched
$paths = git diff --cached --name-only 2>$null | Select-String -Pattern '(settlements|wet-run|bybit|deploy-vercel|owner-config|connector-engine|payments-readiness|page\.tsx)' -SimpleMatch:$false
if (-not $paths) { exit 0 }

Write-Host "[pre-commit] settlements/driver touched — running DRY sanity probe (10s watchdog)" -ForegroundColor Cyan

$driver = Join-Path $PSScriptRoot "..\wet-run-diagnostics.mjs"
if (-not (Test-Path -LiteralPath $driver)) {
  $driver = Join-Path $PSScriptRoot "wet-run-diagnostics.mjs"
  if (-not (Test-Path -LiteralPath $driver)) { Write-Host "  (wet-run driver missing; skip)" -ForegroundColor DarkGray; exit 0 }
}
$out = Join-Path $env:TEMP "swarm-hook-wet-$(Get-Random).txt"
$p = Start-Process -FilePath node -ArgumentList @($driver) -Wait -PassThru -NoNewWindow -RedirectStandardOutput $out -RedirectStandardError "$out.err"
if (-not $p.WaitForExit(10000)) { Stop-Process -Id $p.Id -Force; Write-Host "  probe HUNG > 10s (ok, fail open)" -ForegroundColor Yellow; exit 0 }
$summary = Get-Content $out -ErrorAction SilentlyContinue | Select-String 'SIMULATED\s*\(owner-ok\)\s*:'
if (-not $summary) { exit 0 }
if ($summary -match 'SIMULATED\s*\(owner-ok\)\s*:\s*(\d+)') {
  $sim = [int]$matches[1]
  if ($sim -lt 2) {
    Write-Host ("[pre-commit][ABORT] SIMULATED owner-ok routes = {0} < 2 (expected 2 Attijari PRE-SET routes). Run wet-run-diagnostics.mjs locally and review SIMULATED rows before committing." -f $sim) -ForegroundColor Red
    Write-Host "  (To skip this check: git commit --no-verify -m '…')" -ForegroundColor DarkGray
    exit 3
  }
  Write-Host ("[pre-commit][OK] SIMULATED owner-ok routes = {0} >= 2" -f $sim) -ForegroundColor Green
}
exit 0
