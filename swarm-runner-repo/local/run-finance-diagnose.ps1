# run-finance-diagnose.ps1 — READ-ONLY financial diagnosis
# Repairs the scheduled task "Swarm Finance Diagnose" (was pointing at
# swarm-runner-repo\local\ which never existed -> 0x8007010B, hourly).
#
# Runs only observe-only checks. Moves no money, changes no state.
# Exit code = worst exit code across the checks (fail closed).

$ErrorActionPreference = 'Continue'
$ROOT = 'C:\Users\Dell\Downloads\Nouveau dossier (3)'
$NODE = 'C:\Program Files\nodejs\node.exe'
$LOGD = Join-Path $ROOT 'logs'
if (-not (Test-Path $LOGD)) { New-Item -ItemType Directory -Path $LOGD -Force | Out-Null }
$LOG  = Join-Path $LOGD ('finance-diagnose-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')

Set-Location -LiteralPath $ROOT

$checks = @(
  @{ name = 'financial-policy-audit';   file = 'scripts/financial-policy-audit.mjs';   args = @() },
  @{ name = 'revenue-po-delivery-gate'; file = 'scripts/revenue-po-delivery-gate.mjs'; args = @() },
  @{ name = 'r-hardening-scan';         file = 'scripts/r-hardening-scan.mjs';         args = @() }
)

$lines = @()
$lines += ('finance-diagnose start ' + (Get-Date -Format o))
$lines += ('root=' + $ROOT)
$worst = 0

foreach ($c in $checks) {
  $path = Join-Path $ROOT $c.file
  if (-not (Test-Path $path)) {
    $lines += ("[{0}] MISSING {1}" -f $c.name, $c.file)
    if ($worst -eq 0) { $worst = 3 }
    continue
  }
  $out = & $NODE $path @($c.args) 2>&1 | Out-String
  $code = $LASTEXITCODE
  $lines += ("[{0}] exit={1}" -f $c.name, $code)
  $lines += $out.TrimEnd()
  # 0 = pass, 1 = fail, 2 = unverifiable. Any non-zero is a problem.
  if ($code -ne 0 -and $worst -eq 0) { $worst = $code }
}

$lines += ('finance-diagnose end ' + (Get-Date -Format o))
$lines += ('WORST_EXIT=' + $worst)
$lines | Set-Content -LiteralPath $LOG -Encoding UTF8

# Keep only the 30 most recent logs
Get-ChildItem -LiteralPath $LOGD -Filter 'finance-diagnose-*.log' -ErrorAction SilentlyContinue |
  Sort-Object Name -Descending | Select-Object -Skip 30 |
  Remove-Item -Force -ErrorAction SilentlyContinue

Write-Host ("finance-diagnose worst exit=" + $worst + " log=" + $LOG)
exit $worst
