# FEED-ATTIJARI AUTONOMOUS DEPLOYMENT
# Run with: pwsh -File deploy-feed-attijari.ps1
# or:       powershell -ExecutionPolicy Bypass -File deploy-feed-attijari.ps1
#
# This is the full deployment script. It:
#   1. Pulls the latest commits
#   2. Cleans up failed npm state
#   3. Installs dependencies (with retries + mirror fallback)
#   4. Sets up the offline ledger with the 4 RECOVERY_BANK_WIRE batches
#   5. Generates portal instructions + wire packets
#   6. Starts the feed-attijari-daemon in the background
#   7. Reports status and exits

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$RepoPath  = $PSScriptRoot
$LogDir    = Join-Path $RepoPath "dist_rwc"
$DaemonLog = Join-Path $LogDir "daemon-$(Get-Date -UFormat %Y%m%dT%H%M%SZ).log"
$Stamped   = (Get-Date).ToUniversalTime().ToString("o")

function Step($n, $msg) { Write-Host "`n=== STEP $n : $msg ===" -ForegroundColor Cyan }
function Ok($msg)        { Write-Host "  ok  $msg" -ForegroundColor Green }
function Warn($msg)      { Write-Host "  warn  $msg" -ForegroundColor Yellow }
function Fail($msg)      { Write-Host "  FAIL  $msg" -ForegroundColor Red }

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

Set-Location $RepoPath

# ── Step 1: pull latest ──
Step 1 "Pull latest commits"
try {
  git remote -v | Out-Null
  if ($LASTEXITCODE -eq 0) {
    $branch = git rev-parse --abbrev-ref HEAD
    git pull origin $branch 2>&1 | ForEach-Object { Write-Host "    $_" }
    Ok "on branch $branch"
  } else { Warn "no git remote — assuming local-only" }
} catch { Warn "git pull skipped: $_" }

# ── Step 2: clean up failed npm state ──
Step 2 "Clean up failed npm state"
foreach ($p in @("node_modules", "package-lock.json")) {
  if (Test-Path $p) {
    try {
      Remove-Item -Recurse -Force $p -ErrorAction Stop
      Ok "removed $p"
    } catch { Warn "could not remove $p — close any editor / antivirus holding it: $_" }
  }
}

# ── Step 3: install deps with retries + mirror fallback ──
Step 3 "Install dependencies"
$installOk = $false
$attempts = @(
  @{ name = "primary"; cmd = "npm install --no-audit --no-fund --fetch-timeout=600000" }
  @{ name = "mirror";  cmd = "npm config set registry https://registry.npmmirror.com ; npm install --no-audit --no-fund" }
  @{ name = "minimal"; cmd = "npm install --no-audit --no-fund --no-optional puppeteer-core" }
  @{ name = "global";  cmd = "npm install -g puppeteer-core" }
)
foreach ($a in $attempts) {
  Write-Host "  trying $($a.name)..."
  try {
    Invoke-Expression $a.cmd
    if ($LASTEXITCODE -eq 0) {
      Ok "$($a.name) succeeded"
      $installOk = $true; break
    } else { Warn "$($a.name) exited $LASTEXITCODE" }
  } catch { Warn "$($a.name) failed: $_" }
}
if (-not $installOk) {
  Warn "npm install failed on all attempts — continuing with what's available"
}

# ── Step 4: seed offline ledger ──
Step 4 "Seed offline ledger with RECOVERY_BANK_WIRE batches"
try {
  $out = node scripts/seed-offline-ledger-recovery.mjs 2>&1
  $out | ForEach-Object { Write-Host "    $_" }
  if ($LASTEXITCODE -eq 0) { Ok "offline ledger seeded" } else { Warn "offline ledger seeding failed: $LASTEXITCODE" }
} catch { Warn "seed-offline-ledger-recovery: $_" }

# ── Step 5: generate portal instructions + wire packets ──
Step 5 "Generate portal instructions and wire packets"
try {
  $out = node scripts/generate-portal-instructions.mjs 2>&1
  $out | ForEach-Object { Write-Host "    $_" }
  Ok "portal instructions regenerated"
} catch { Warn "generate-portal-instructions: $_" }
try {
  $env:ALLOW_OFFLINE_LEDGER = "true"
  $out = node scripts/auto-attijari-wire.mjs 2>&1
  $out | ForEach-Object { Write-Host "    $_" }
  Ok "auto-attijari-wire ran"
} catch { Warn "auto-attijari-wire: $_" }

# ── Step 6: detect credentials ──
Step 6 "Detect credentials"
$creds = [ordered]@{
  WISE_API_KEY                 = $env:WISE_API_KEY
  WISE_PROFILE_ID              = $env:WISE_PROFILE_ID
  BANKING_CIRCLE_CLIENT_ID     = $env:BANKING_CIRCLE_CLIENT_ID
  BANKING_CIRCLE_CLIENT_SECRET = $env:BANKING_CIRCLE_CLIENT_SECRET
  BC_DEBTOR_ACCOUNT            = $env:BC_DEBTOR_ACCOUNT
  PUPPETEER_EXECUTABLE_PATH    = $env:PUPPETEER_EXECUTABLE_PATH
}
$creds.GetEnumerator() | ForEach-Object {
  $val = $_.Value
  $display = if ($val) { ("*" * [Math]::Min(8, $val.Length)) + " (len $($val.Length))" } else { "(unset)" }
  $color = if ($val) { "Green" } else { "DarkGray" }
  Write-Host ("    {0,-32} = {1}" -f $_.Key, $display) -ForegroundColor $color
}

# ── Step 7: start the autonomous daemon ──
Step 7 "Start feed-attijari-daemon (background)"
$existing = Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*feed-attijari-daemon*" }
if ($existing) {
  Ok "daemon already running (PID $($existing.Id)) — leaving it"
} else {
  try {
    $proc = Start-Process -FilePath "node" -ArgumentList "scripts/feed-attijari-daemon.mjs --interval=60" `
      -WorkingDirectory $RepoPath -RedirectStandardOutput $DaemonLog -RedirectStandardError "$DaemonLog.err" `
      -PassThru
    Start-Sleep -Seconds 2
    if (-not (Get-Process -Id $proc.Id -ErrorAction SilentlyContinue)) {
      Fail "daemon exited immediately; see $DaemonLog.err"
      Get-Content $DaemonLog.err -Tail 20
    } else {
      Ok "daemon started PID $($proc.Id) — log $DaemonLog"
    }
  } catch { Fail "could not start daemon: $_" }
}

# ── Step 8: final status ──
Step 8 "Final status"
Write-Host "  Repository:      $RepoPath"
Write-Host "  Branch:          $(git rev-parse --abbrev-ref HEAD)"
Write-Host "  Commits ahead:   $(git rev-list --count origin/main..HEAD 2>$null)"
Write-Host "  Wire packets:    $((Get-ChildItem exports/bank-wire/*.txt -ErrorAction SilentlyContinue).Count)"
Write-Host "  Portal instr:    $((Get-ChildItem exports/settlement/instructions/wire_*.json -ErrorAction SilentlyContinue).Count)"
Write-Host "  MT103 files:     $((Get-ChildItem settlements/bank_wires/mt103_BATCH_RECOVERY_*.txt -ErrorAction SilentlyContinue).Count)"
Write-Host "  Daemon log:      $DaemonLog"
Write-Host ""
Write-Host "Next: set BC or Wise creds in this terminal, or run:"
Write-Host "  .\deploy-feed-attijari.ps1     # re-run safely (idempotent)"
Write-Host ""
Write-Host "Done." -ForegroundColor Green
