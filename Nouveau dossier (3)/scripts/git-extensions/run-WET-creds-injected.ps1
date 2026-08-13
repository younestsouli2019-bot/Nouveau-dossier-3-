#Requires -Version 5
<#
.SYNOPSIS
  One-click WET driver launcher: dot-sources YOUR local paste file
  wet-run-owner-secrets.local.ps1 (NEVER COMMITTED), injects its values as
  Process-scope env vars, then runs wet-run-owner-settlements-LIVE.ps1 with
  the literal CONFIRM gate you approved earlier.

.DESCRIPTION
  Safety guarantees (same as the engine):
    - Owner-only recipient gate runs BEFORE any network call
    - confirmCard.live=true on every routed run (strict WET provenance)
    - SWARM_LIVE_PAYMENTS=true set in Process env only
    - Script uses SupportsShouldProcess (-WhatIf safe)
#>
[CmdletBinding(SupportsShouldProcess=$true)]
param(
  [switch]$Force  # skip interactive CONFIRM re-prompt after you paste creds
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$secrets = Join-Path $here 'wet-run-owner-secrets.local.ps1'
$driver  = Join-Path $here 'wet-run-owner-settlements-LIVE.ps1'

if (-not (Test-Path -LiteralPath $secrets)) {
  Write-Warning "Missing paste template: $secrets"
  Write-Host "  1. Copy wet-run-owner-secrets.local.ps1 next to this file"
  Write-Host "  2. Paste YOUR owner identifiers (EMAIL / RIBs / 5x WALLETs) into WET_OWNER"
  Write-Host "  3. Paste VAULT LIVE creds (PayPal/Payoneer/Bank/Crypto/Attijari) into WET_VAULT"
  Write-Host "  4. Re-run: powershell -ExecutionPolicy Bypass -File scripts/git-extensions/run-WET-creds-injected.ps1"
  exit 2
}
if (-not (Test-Path -LiteralPath $driver)) {
  Write-Warning "Missing driver: $driver"
  exit 2
}

Write-Host '==> [step 1/4] dot-source your local paste template' -ForegroundColor Cyan
. $secrets

Write-Host '==> [step 2/4] validate paste template completeness (no live values logged, only set/unset)' -ForegroundColor Cyan
$ownerMissing = 0
foreach ($k in $WET_OWNER.Keys) { if (-not $WET_OWNER[$k]) { Write-Warning "  OWNER missing: $k" ; $ownerMissing++ } }
$vaultMissing = 0
foreach ($k in $WET_VAULT.Keys) { if (-not $WET_VAULT[$k]) { Write-Warning "  VAULT missing: $k" ; $vaultMissing++ } }
$oDone = $WET_OWNER.Count - $ownerMissing; $oTot = $WET_OWNER.Count
$vDone = $WET_VAULT.Count - $vaultMissing; $vTot = $WET_VAULT.Count
$line1 = '  OWNER  - {0}/{1} populated' -f $oDone, $oTot
$line2 = '  VAULT  - {0}/{1} populated' -f $vDone, $vTot
Write-Host $line1
Write-Host $line2

Write-Host '==> [step 3/4] inject env vars into Process-scope ONLY (sandbox never sees them written to disk)' -ForegroundColor Cyan
[Environment]::SetEnvironmentVariable('SWARM_LIVE_PAYMENTS', 'true', 'Process')
$env:SWARM_LIVE_PAYMENTS = 'true'
[Environment]::SetEnvironmentVariable('OWNER_EMAIL',           $WET_OWNER.EMAIL,           'Process')
[Environment]::SetEnvironmentVariable('OWNER_NAME',            $WET_OWNER.NAME,            'Process')
[Environment]::SetEnvironmentVariable('OWNER_ATTIJARI_RIB_1',  $WET_OWNER.ATTIJARI_RIB_1,  'Process')
[Environment]::SetEnvironmentVariable('OWNER_ATTIJARI_RIB_2',  $WET_OWNER.ATTIJARI_RIB_2,  'Process')
[Environment]::SetEnvironmentVariable('OWNER_ATTIJARI_RIB_3',  $WET_OWNER.ATTIJARI_RIB_3,  'Process')
foreach ($net in @('ARBITRUM','OPTIMISM','BASE','POLYGON','LINEA')) {
  $var = 'OWNER_WALLET_' + $net
  $val = $WET_OWNER[('WALLET_' + $net)]
  [Environment]::SetEnvironmentVariable($var, $val, 'Process')
}
foreach ($k in @('PAYPAL_LIVE_CLIENT_ID','PAYPAL_LIVE_SECRET','PAYONEER_API_TOKEN','PAYONEER_PROGRAM_ID','PAYONEER_PARTNER_ID','BANK_API_KEY','BANK_API_ENDPOINT','CRYPTO_SIGNING_URL')) {
  [Environment]::SetEnvironmentVariable($k, $WET_VAULT[$k], 'Process')
}
# Attijari cert/key translation (the WET driver reads ATTIJARI_CLIENT_CERT as base64 + ATTIJARI_CLIENT_KEY as passphrase)
[Environment]::SetEnvironmentVariable('ATTIJARI_CLIENT_CERT', $WET_VAULT.ATTIJARI_CLIENT_CERT_B64, 'Process')
[Environment]::SetEnvironmentVariable('ATTIJARI_CLIENT_KEY',  $WET_VAULT.ATTIJARI_CLIENT_KEY_PASS, 'Process')

Write-Host '==> [step 4/4] run STRICT WET driver (no dry, no sim)' -ForegroundColor Cyan
$argList = @()
if ($Force) { $argList += '-Force' }
if ($PSBoundParameters.ContainsKey('WhatIf')) {
  Write-Host '  -WhatIf: would call driver, no actual network submissions done.'
  exit 0
}
& powershell -NoProfile -ExecutionPolicy Bypass -File $driver @argList
exit $LASTEXITCODE
