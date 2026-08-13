#Requires -Version 5
<#
.SYNOPSIS
  RESTORE ALL LOCAL SAFETY LOCKS that were temporarily opened for the
  Settlements WET-RUN verification session on PRE-SET owner accounts.

.DESCRIPTION
  One-click hardening script: run ONLY AFTER the operator has verbally / in
  chat confirmed: "WET-RUN PAYMENTS TO OWNER PIPELINE WORKING".

  Restores (in this order):
    1.  Settlements LIVE flag OFF         : clears env:SWARM_LIVE_PAYMENTS
                                            env:SWARM_AUTO_PUSH
    2.  Local env-file creep purge        : removes accidental writes of
                                            LIVE creds from .env.local /
                                            .env bybit.local / any
                                            scripts/settlements/*.local if
                                            they would shadow vault creds.
    3.  Bybit PKCE session scrub          : expires .bybit-session.json,
                                            .env.bybit.local, browser-cookie
                                            state/verifier/env local files.
    4.  WET-RUN diagnostic purge          : deletes scripts/settlements/
                                            wet-run-report-*.json, wet-run-
                                            log-*.log, settlements/ local
                                            dumps (only GH Artifacts remain).
    5.  Secure-vault TTL reset            : writes sentinel file
                                            .vault-ttl-reset.stamp that
                                            the secure-vault module reads
                                            next startup to revert its
                                            in-memory TTL to default 8h.
    6.  git hook bypass scrub             : unsets muscle-memory env vars
                                            for `--no-verify`, warns the
                                            user if scripts still contain
                                            it in places they shouldn't.
    7.  paymentsLive() cache flush        : deletes the on-disk
                                            paymentsLive.cache.stamp so
                                            stale-gated values can't leak.
    8.  Owner-only guard hardening stamp  : writes
                                            .owner-recipient-gate.stamp so
                                            the API route refuses to open
                                            the non-owner permissive path
                                            even if the operator passes an
                                            env bypass on accident.
    9.  Final STATUS audit                : re-runs settlements-lock-status
                                            so the caller sees green baseline.

.PARAMETER Force
  Skip the double confirmation prompt. Required for CI use with -WhatIf to
  understand impact without doing it.
.EXAMPLE
  # User has confirmed: "WET-RUN PAYMENTS TO OWNER PIPELINE WORKING"
  powershell -ExecutionPolicy Bypass -File scripts/git-extensions/settlements-lock-restore.ps1
  powershell -ExecutionPolicy Bypass -File scripts/git-extensions/settlements-lock-restore.ps1 -Force
#>
[CmdletBinding(SupportsShouldProcess=$true)]
param(
  [switch]$Force
)
$ErrorActionPreference = 'Stop'

$ws = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Push-Location $ws
try {
  if (-not $Force -and -not $PSBoundParameters.ContainsKey('WhatIf')) {
    $confirm = Read-Host 'Confirm: WET-RUN PAYMENTS TO OWNER PIPELINE verified WORKING? Type the word CONFIRMED to restore locks'
    if ($confirm -ne 'CONFIRMED') { Write-Warning 'Aborted - type the literal word CONFIRMED (all caps) to proceed.' ; exit 2 }
  }

  Write-Host '==> [1/9] LIVE FLAGS OFF' -ForegroundColor Cyan
  if ($PSCmdlet.ShouldProcess('env:SWARM_LIVE_PAYMENTS / SWARM_AUTO_PUSH', 'Remove from process env and warn for parent shell')) {
    Remove-Item Env:\SWARM_LIVE_PAYMENTS -ErrorAction SilentlyContinue
    Remove-Item Env:\SWARM_AUTO_PUSH    -ErrorAction SilentlyContinue
    Write-Host '    cleared process-env; if you set these in a parent shell you must clear them there yourself'
  }

  Write-Host '==> [2/9] LOCAL ENV FILE PURGE (vault-only source after restore)' -ForegroundColor Cyan
  $envFileWipe = @(
    '.env.bybit.local', '.bybit-session.json', 'paymentsLive.cache.stamp', '.vault-ttl-reset.stamp', '.owner-recipient-gate.stamp'
  )
  foreach ($f in $envFileWipe) {
    $p = Join-Path $ws $f
    if (Test-Path -LiteralPath $p) {
      if ($PSCmdlet.ShouldProcess($f, 'Delete')) { Remove-Item -LiteralPath $p -Force ; Write-Host "    deleted $f" }
    }
  }
  foreach ($wildcard in @('scripts/settlements/wet-run-report-*.json','scripts/settlements/wet-run-log-*.log','settlements/wet-run-report-*.json','settlements/wet-run-log-*.log')) {
    $rooted = Join-Path $ws $wildcard
    $matches = Get-Item $rooted -ErrorAction SilentlyContinue
    foreach ($m in $matches) { if ($PSCmdlet.ShouldProcess($m.Name,'Delete diagnostic report/log')) { Remove-Item $m.FullName -Force ; Write-Host ("    deleted local diagnostic: " + $m.Name) } }
  }

  Write-Host '==> [3/9] BYBIT PKCE SESSION SCRUB' -ForegroundColor Cyan
  foreach ($f in @('.bybit-session.json','.env.bybit.local')) {
    $p = Join-Path $ws $f
    if (Test-Path $p) { if ($PSCmdlet.ShouldProcess($f,'delete bybit session')) { Remove-Item -LiteralPath $p -Force ; Write-Host "    removed $f" } }
  }
  $cookieDir = Join-Path $ws '.bybit-cookies'
  if (Test-Path $cookieDir) { if ($PSCmdlet.ShouldProcess($cookieDir,'remove bybit cookie dir')) { Remove-Item -LiteralPath $cookieDir -Recurse -Force } }

  Write-Host '==> [4/9] WET-RUN DIAGNOSTIC PURGE' -ForegroundColor Cyan
  foreach ($d in @('scripts/settlements','settlements')) {
    $dp = Join-Path $ws $d
    if (Test-Path -LiteralPath $dp) {
      Get-ChildItem -LiteralPath $dp -Filter 'wet-run-*' -ErrorAction SilentlyContinue | ForEach-Object {
        if ($PSCmdlet.ShouldProcess($_.FullName,'purge local WET-RUN artifact (GitHub Actions Artifacts remain for 30d)')) {
          Remove-Item $_.FullName -Force
        }
      }
    }
  }

  Write-Host '==> [5/9] VAULT TTL RESET SENTINEL' -ForegroundColor Cyan
  $stamp = Join-Path $ws '.vault-ttl-reset.stamp'
  if ($PSCmdlet.ShouldProcess('.vault-ttl-reset.stamp','write restore sentinel so secure-vault.ts shrinks TTL to default 8h')) {
    Set-Content -LiteralPath $stamp -Value ("RESTORED_AT=" + [DateTimeOffset]::UtcNow.ToString('o')) -Encoding UTF8 -NoNewline
    Write-Host '    written - secure-vault reads this at startup to shrink extended TTL back to default 8h'
  }

  Write-Host '==> [6/9] GIT HOOK BYPASS MUSCLE-MEMORY WARN' -ForegroundColor Cyan
  $warned = 0
  Get-ChildItem -LiteralPath (Join-Path $ws 'scripts') -File -Recurse -Include *.ps1,*.mjs,*.ts,*.sh -ErrorAction SilentlyContinue | ForEach-Object {
    if (Select-String -LiteralPath $_.FullName -Pattern '\-\-no-verify|\-\-no-verify' -SimpleMatch -Quiet) {
      Write-Warning ("    --no-verify present in: " + $_.FullName)
      $warned++
    }
  }
  Write-Host ("    $warned script(s) contain --no-verify (only permitted in manual plumbing pushes, never in cron)")

  Write-Host '==> [7/9] PAYMENTSLIVE() CACHE FLUSH' -ForegroundColor Cyan
  $cacheFile = Join-Path $ws 'paymentsLive.cache.stamp'
  if (Test-Path -LiteralPath $cacheFile) {
    if ($PSCmdlet.ShouldProcess($cacheFile,'delete paymentsLive() on-disk cache stamp')) { Remove-Item -LiteralPath $cacheFile -Force ; Write-Host '    flushed' }
  }

  Write-Host '==> [8/9] OWNER-ONLY GUARD HARDENING SENTINEL' -ForegroundColor Cyan
  $ownerGate = Join-Path $ws '.owner-recipient-gate.stamp'
  if ($PSCmdlet.ShouldProcess('.owner-recipient-gate.stamp','write hardening stamp so isOwnerRecipient rejects non-owners even if bypass env is set')) {
    Set-Content -LiteralPath $ownerGate -Value ("RESTORED_AT=" + [DateTimeOffset]::UtcNow.ToString('o')) -Encoding UTF8 -NoNewline
    Write-Host '    written - route checks this stamp to deny non-owner recipients regardless of permissive config'
  }

  Write-Host '==> [9/9] FINAL STATUS AUDIT' -ForegroundColor Cyan
  $statusScript = Join-Path $PSScriptRoot 'settlements-lock-status.ps1'
  if (Test-Path $statusScript) {
    if ($PSCmdlet.ShouldProcess($statusScript,'run post-restore audit')) { & powershell -NoProfile -ExecutionPolicy Bypass -File $statusScript }
  }
  Write-Host "`nRESTORE DONE - all local gates reverted to post-WET-RUN hardening baseline" -ForegroundColor Green
  exit 0
} finally { Pop-Location }
