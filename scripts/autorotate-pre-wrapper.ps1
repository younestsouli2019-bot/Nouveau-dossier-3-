#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
$ROOT = Split-Path -Parent $PSScriptRoot
$RUNNER = Join-Path $ROOT 'scripts\t7-git-secrets-autorotate-v358.mjs'
$NODE = (Get-Command node -ErrorAction SilentlyContinue).Source

if (-not $NODE) {
  Write-Host '[AUTOROTATE] SKIP (node not on PATH) exit=0 (tolerated no gate)'
  $global:LASTEXITCODE = 0
  return
}

if (-not (Test-Path $RUNNER)) {
  Write-Host "[AUTOROTATE] SKIP runner not found $RUNNER exit=0 (tolerated pre-deploy)"
  $global:LASTEXITCODE = 0
  return
}

$args = @($RUNNER, '--pre-wrapper-mode', '--min-age-minutes=1440')
& $NODE @($RUNNER,'--pre-wrapper-mode','--min-age-minutes=1440')
$global:LASTEXITCODE = $LASTEXITCODE
