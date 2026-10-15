# run-owner-handsfree-live.ps1 — FAIL-CLOSED payout gate
# Repairs the scheduled task "Swarm Owner Hands-Free Live" (was pointing at
# swarm-runner-repo\local\ which never existed -> 0x8007010B, every 15 min).
#
# WHY THIS REFUSES TO PAYOUT BY DEFAULT
# --------------------------------------
# The task fires every 15 minutes with no human in the loop. Wiring it
# straight to a payout script would move money unattended. This wrapper
# instead verifies the preconditions and exits WITHOUT executing unless
# every gate is genuinely satisfied. Absent evidence => no execution.
#
# To actually enable auto-payout you must set, deliberately:
#   $env:PAYOUT_CONFIRM_AUTO = 'yes-i-accept-unguarded-transfers'
# and confirm every check below reports PASS.
#
# Exit codes: 0 = preconditions verified (still does not itself transfer)
#             5 = fail-closed, one or more gates not satisfied

$ErrorActionPreference = 'Continue'
$ROOT = 'C:\Users\Dell\Downloads\Nouveau dossier (3)'
$NODE = 'C:\Program Files\nodejs\node.exe'
$LOGD = Join-Path $ROOT 'logs'
if (-not (Test-Path $LOGD)) { New-Item -ItemType Directory -Path $LOGD -Force | Out-Null }
$LOG  = Join-Path $LOGD ('handsfree-gate-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')

Set-Location -LiteralPath $ROOT

$lines = @()
$lines += ('handsfree-gate start ' + (Get-Date -Format o))
$failed = @()

function Check([string]$name, [bool]$ok, [string]$detail) {
  $script:lines += ("[{0}] {1} :: {2}" -f $(if ($ok) {'PASS'} else {'FAIL'}), $name, $detail)
  if (-not $ok) { $script:failed += $name }
}

# 1. Database reachable — preset OwnerAccounts live here.
$dbSet = -not [string]::IsNullOrEmpty($env:DATABASE_URL)
Check 'DATABASE_URL' $dbSet $(if ($dbSet) {'set'} else {'UNSET - preset owner accounts unreachable'})

# 2. Hands-free policy gate — the repo's own fail-closed switch.
$policy = $env:OWNER_HANDS_FREE_POLICY -eq 'true'
Check 'OWNER_HANDS_FREE_POLICY' $policy $(if ($policy) {'true'} else {'not true - hands-free is OFF'})

# 3. Tick secret present.
$tick = -not [string]::IsNullOrEmpty($env:PAYOUT_TICK_SECRET)
Check 'PAYOUT_TICK_SECRET' $tick $(if ($tick) {'set'} else {'UNSET'})

# 4. Source of funds must not be zero. Read-only ledger read, no transfer.
$ledgerPath = Join-Path $ROOT 'data\out\authorizer-ledger-report.json'
$balanceOk = $false
$balDetail = 'ledger report absent'
if (Test-Path $ledgerPath) {
  try {
    $led = Get-Content -LiteralPath $ledgerPath -Raw | ConvertFrom-Json
    $sum = 0; foreach ($a in $led.accounts) { $sum += [double]$a.balance }
    $balDetail = ('sum of 7 accounts = ' + $sum + ' as of ' + $led.at)
    $balanceOk = ($sum -gt 0)
  } catch { $balDetail = 'ledger unreadable: ' + $_.Exception.Message }
}
Check 'NONZERO_SOURCE_BALANCE' $balanceOk $balDetail

# 5. Bank rail credentials. The routing log shows 30/30 QUARANTINE on these.
$attijariReady = (-not [string]::IsNullOrEmpty($env:ATTIJARI_CLIENT_ID)) -and
                 (-not [string]::IsNullOrEmpty($env:ATTIJARI_CLIENT_SECRET)) -and
                 (-not [string]::IsNullOrEmpty($env:ATTIJARI_API_BASE))
Check 'ATTIJARI_PSD2' $attijariReady $(if ($attijariReady) {'injected'} else {'client_id/client_secret/api_base not injected'})

# 6. Never run under an unattended retrigger without explicit opt-in.
$confirmed = $env:PAYOUT_CONFIRM_AUTO -eq 'yes-i-accept-unguarded-transfers'
Check 'EXPLICIT_UNGUARDED_OPTIN' $confirmed $(if ($confirmed) {'set'} else {'not set - refusing unattended transfer'})

if ($failed.Count -eq 0) {
  $lines += 'ALL GATES PASS - preconditions verified. This wrapper still performs no transfer;'
  $lines += 'invoke scripts/daemon-tick-hands-free-v3.5.1.ts deliberately to execute.'
  $exit = 0
} else {
  $lines += ('FAIL-CLOSED. ' + $failed.Count + ' gate(s) not satisfied: ' + ($failed -join ', '))
  $lines += 'No payout attempted. No state changed.'
  $exit = 5
}

$lines += ('handsfree-gate end ' + (Get-Date -Format o))
$lines += ('EXIT=' + $exit)
$lines | Set-Content -LiteralPath $LOG -Encoding UTF8

Get-ChildItem -LiteralPath $LOGD -Filter 'handsfree-gate-*.log' -ErrorAction SilentlyContinue |
  Sort-Object Name -Descending | Select-Object -Skip 30 |
  Remove-Item -Force -ErrorAction SilentlyContinue

Write-Host ("handsfree-gate exit=" + $exit + " failed=" + ($failed -join ','))
exit $exit
