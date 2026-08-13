#Requires -Version 5
<#
.SYNOPSIS
  Prints green/red status for the 12 SETTLEMENTS WET-RUN SAFETY LOCKS so an
  operator can (a) confirm gates are OPEN for the verification phase and
  then (b) confirm gates are RESTORED after the pipeline is working.

.DESCRIPTION
  Exit codes:
    0 — ALL locks RESTORED (post-WET-RUN baseline)
    1 — ≥1 gates are still OPEN for the verification phase
    2 — Usage error / bad invocation
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'

$ws = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Push-Location $ws
try {
  [System.Collections.ArrayList]$results = @()
  function add($name, $locked, $note) {
    $null = $results.Add([pscustomobject]@{ Gate = $name; Locked = [bool]$locked; Note = $note })
  }

  # 1. LIVE flag
  $liveOpen = ($env:SWARM_LIVE_PAYMENTS -eq 'true')
  $liveVal = if ($env:SWARM_LIVE_PAYMENTS) { $env:SWARM_LIVE_PAYMENTS } else { '(unset - post-WET-RUN baseline OK)' }
  add 'SWARM_LIVE_PAYMENTS env' (-not $liveOpen) ('current=' + $liveVal)

  # 2-6. Vault credentials must NOT be in env (if they are, they got lifted out of the vault for WET-RUN verify)
  $vaultCredKeys = @('PAYPAL_CLIENT_ID','PAYPAL_CLIENT_SECRET','PAYONEER_CLIENT_ID','PAYONEER_CLIENT_SECRET',
                     'ATTIJARI_PSD2_CLIENT_ID','ATTIJARI_PSD2_MTLS_CERT','CRYPTO_SIGNER_ENDPOINT','CRYPTO_SIGNER_HMAC',
                     'BANK_WIRE_USER','BANK_WIRE_PASS','WISE_API_TOKEN')
  $credLift = 0
  foreach ($k in $vaultCredKeys) {
    $v = [Environment]::GetEnvironmentVariable($k, 'Process')
    if ($v) { $credLift++ }
    $vUser = [Environment]::GetEnvironmentVariable($k, 'User')
    if ($vUser) { $credLift++ }
  }
  add 'Vault-only cred source (no env shadow)' ($credLift -eq 0) ($credLift.ToString() + ' cred key(s) visible in env (restore = rotate vault creds + remove env copies)')

  # 7. Secure-vault extended TTL stamp (stamp present = TTL already reset)
  $ttlStamp = Test-Path -LiteralPath (Join-Path $ws '.vault-ttl-reset.stamp')
  $ttlNote = if ($ttlStamp) { 'present' } else { 'absent (TTL may be extended for verification)' }
  add 'Secure-vault TTL 8h reset sentinel' $ttlStamp $ttlNote

  # 8. Bybit session tokens absent (post-WET-RUN baseline OK)
  $bybitClean = -not (Test-Path -LiteralPath (Join-Path $ws '.bybit-session.json')) -and -not (Test-Path -LiteralPath (Join-Path $ws '.env.bybit.local')) -and -not (Test-Path -LiteralPath (Join-Path $ws '.bybit-cookies'))
  $bybitNote = if (-not $bybitClean) { '.bybit-session.json OR .env.bybit.local present' } else { 'OK' }
  add 'Bybit PKCE session scrubbed' $bybitClean $bybitNote

  # 9. No local WET-RUN diagnostic dumps (only GitHub Artifacts 30-day keep)
  $dumps = 0
  foreach ($d in @('scripts/settlements','settlements')) {
    $dp = Join-Path $ws $d
    if (Test-Path $dp) {
      $dumps += (Get-ChildItem -LiteralPath $dp -Filter 'wet-run-*' -ErrorAction SilentlyContinue | Measure-Object).Count
    }
  }
  add 'No local WET-RUN JSON/log dumps' ($dumps -eq 0) ($dumps.ToString() + ' local WET-RUN file(s); use restore script to delete them')

  # 10. paymentsLive() cache flushed
  $plcClean = -not (Test-Path -LiteralPath (Join-Path $ws 'paymentsLive.cache.stamp'))
  $plcNote = if ($plcClean) { 'OK' } else { 'stale stamp still present' }
  add 'paymentsLive() on-disk cache flushed' $plcClean $plcNote

  # 11. Owner-only guard hardening sentinel
  $oGate = Test-Path -LiteralPath (Join-Path $ws '.owner-recipient-gate.stamp')
  $oGateNote = if ($oGate) { 'present' } else { 'absent (permissive fallback possible)' }
  add 'Owner-recipient gate HARDEN stamp' $oGate $oGateNote

  # 12. No --no-verify outside plumbing scripts (muscle-memory leakage)
  $nvCount = 0
  Get-ChildItem -LiteralPath (Join-Path $ws '.github') -Recurse -Include *.yml,*.yaml -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      if (Select-String -LiteralPath $_.FullName -Pattern '\-\-no-verify' -SimpleMatch -Quiet -ErrorAction SilentlyContinue) { $nvCount++ }
    } catch { }
  }
  # Workflow yml should ONLY run --no-verify in the manual deploy-vercel plumbing, never in cron jobs
  add '--no-verify absent from CI workflows' ($nvCount -eq 0) ($nvCount.ToString() + ' workflow(s) use --no-verify (check if this is the manual deploy job allowed only, never cron)')

  $openCount = ($results | Where-Object { -not $_.Locked }).Count
  Write-Host ''
  Write-Host '================================ SETTLEMENTS LOCKS STATUS ================================'
  Write-Host ('  Baseline: ALL green = post-WET-RUN RESTORED ({0} gates)' -f $results.Count)
  Write-Host ('  Open gates for verification right now: {0}/{1}' -f $openCount, $results.Count)
  Write-Host '=========================================================================================='
  foreach ($r in $results) {
    $color = if ($r.Locked) { 'Green' } else { 'Red' }
    $badge = if ($r.Locked) { '  LOCKED   ' } else { '  OPEN    ' }
    Write-Host ('{0}{1,-42} {2}' -f $badge, $r.Gate, $r.Note) -ForegroundColor $color
  }
  Write-Host ''
  if ($openCount -eq 0) { Write-Host 'RESULT: ALL LOCKS RESTORED ✅' -ForegroundColor Green ; exit 0 }
  elseif ($openCount -lt 5) { Write-Host ('RESULT: ' + $openCount + ' gate(s) OPEN — expected during verification, then restore them') -ForegroundColor Yellow ; exit 1 }
  else { Write-Host ('RESULT: ' + $openCount + ' gates OPEN — fully unlocked verification phase. Run settlements-lock-restore.ps1 after CONFIRMED.') -ForegroundColor Red ; exit 1 }
} finally { Pop-Location }
