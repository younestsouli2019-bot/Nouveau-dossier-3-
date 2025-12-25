param(
  [Parameter(Position = 0)]
  [string]$Action = "readiness"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $root | Out-Null

$credsPath = Join-Path $root "CREDS.txt"
if (-not (Test-Path -LiteralPath $credsPath)) {
  throw "Missing CREDS.txt next to deploy-live.ps1"
}

$lines = Get-Content -LiteralPath $credsPath -ErrorAction Stop

function FirstMatch([string]$pattern) {
  foreach ($l in $lines) {
    if ($l -match $pattern) { return $Matches }
  }
  return $null
}

function GetCredValue([string]$name) {
  foreach ($l in $lines) {
    $t = $l.Trim()
    if (-not $t) { continue }
    if ($t -match ("^" + [regex]::Escape($name) + "\s*[:=]\s*(.+)$")) {
      $v = $Matches[1].Trim()
      if ($v) { return $v }
    }
  }
  return $null
}

function NextNonEmptyAfter([string]$needle) {
  $idx = -1
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i].Trim() -eq $needle) { $idx = $i; break }
  }
  if ($idx -lt 0) { return $null }
  for ($j = $idx + 1; $j -lt $lines.Count; $j++) {
    $v = $lines[$j].Trim()
    if ($v -and $v -ne "Disabled" -and ($v -notmatch "^[•]+$")) { return $v }
  }
  return $null
}

function Mask([string]$v) {
  if ([string]::IsNullOrWhiteSpace($v)) { return "(missing)" }
  return "(set)"
}

$payoneerEmail = $null
foreach ($l in $lines) {
  if ($l -match "^Payoneer:(.+)$") { $payoneerEmail = $Matches[1].Trim(); break }
}

$paypalEmail = $null
foreach ($l in $lines) {
  if ($l -match "^paypal:(.+)$") { $paypalEmail = $Matches[1].Trim(); break }
}

$paypalClientId = NextNonEmptyAfter "Client ID"
$paypalClientSecret = NextNonEmptyAfter "Secret key 2"

$swiftMatch = FirstMatch("^CODE SWIFT\s*:\s*(.+)$")
$bankSwift = if ($swiftMatch) { $swiftMatch[1].Trim() } else { $null }

$ribLine = $null
foreach ($l in $lines) {
  if ($l -match "^\s*\d{3}\s+\d{3}\s+\d{10,}\s+\d{2}\s*$") {
    $ribLine = ($l -replace "\s+", " ").Trim()
    break
  }
}

$bankName = $null
foreach ($l in $lines) {
  if ($l -match "Attijariwafa") { $bankName = "Attijariwafa bank"; break }
}

$beneficiaryName = $null
foreach ($l in $lines) {
  if ($l -match "^\s*M\s+TSOULI\s+YOUNES\s*$") { $beneficiaryName = "M TSOULI YOUNES"; break }
}

if ($paypalClientId) { $env:PAYPAL_CLIENT_ID = $paypalClientId }
if ($paypalClientSecret) { $env:PAYPAL_CLIENT_SECRET = $paypalClientSecret }
$env:PAYPAL_MODE = "live"
$env:SWARM_LIVE = "true"
if (-not $env:BASE44_ENABLE_REVENUE_FROM_PAYPAL) { $env:BASE44_ENABLE_REVENUE_FROM_PAYPAL = "true" }

if (-not $env:BASE44_APP_ID) { $env:BASE44_APP_ID = GetCredValue "BASE44_APP_ID" }
if (-not $env:BASE44_SERVICE_TOKEN) { $env:BASE44_SERVICE_TOKEN = GetCredValue "BASE44_SERVICE_TOKEN" }
if (-not $env:PAYPAL_WEBHOOK_ID) { $env:PAYPAL_WEBHOOK_ID = GetCredValue "PAYPAL_WEBHOOK_ID" }

if ($bankSwift) { $env:BANK_SWIFT = $bankSwift }
if ($bankName) { $env:BANK_NAME = $bankName }
if ($beneficiaryName) { $env:BANK_BENEFICIARY_NAME = $beneficiaryName }
if ($ribLine) {
  $env:BANK_RIB = $ribLine
  if (-not $env:BANK_ACCOUNT) { $env:BANK_ACCOUNT = $ribLine }
}

if ($env:BANK_NAME -or $env:BANK_SWIFT -or $env:BANK_ACCOUNT -or $env:BANK_BENEFICIARY_NAME) {
  $obj = @{
    bank = $env:BANK_NAME
    swift = $env:BANK_SWIFT
    account = $env:BANK_ACCOUNT
    beneficiary = $env:BANK_BENEFICIARY_NAME
  }
  $env:BASE44_PAYOUT_DESTINATION_JSON = ($obj | ConvertTo-Json -Compress)
}

if ([string]::IsNullOrWhiteSpace($env:BASE44_APP_ID)) {
  $env:BASE44_APP_ID = Read-Host "BASE44_APP_ID (app id or Base44 app URL)"
}
if ([string]::IsNullOrWhiteSpace($env:BASE44_SERVICE_TOKEN)) {
  $sec = Read-Host "BASE44_SERVICE_TOKEN" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { $env:BASE44_SERVICE_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
if ([string]::IsNullOrWhiteSpace($env:PAYPAL_WEBHOOK_ID)) {
  $env:PAYPAL_WEBHOOK_ID = Read-Host "PAYPAL_WEBHOOK_ID"
}

Write-Host ("SWARM_LIVE=" + $env:SWARM_LIVE)
Write-Host ("PAYPAL_CLIENT_ID " + (Mask $env:PAYPAL_CLIENT_ID))
Write-Host ("PAYPAL_CLIENT_SECRET " + (Mask $env:PAYPAL_CLIENT_SECRET))
Write-Host ("PAYPAL_WEBHOOK_ID " + (Mask $env:PAYPAL_WEBHOOK_ID))
Write-Host ("BASE44_APP_ID " + (Mask $env:BASE44_APP_ID))
Write-Host ("BASE44_SERVICE_TOKEN " + (Mask $env:BASE44_SERVICE_TOKEN))
if ($payoneerEmail) { Write-Host ("Payoneer email: " + $payoneerEmail) }
if ($paypalEmail) { Write-Host ("PayPal email: " + $paypalEmail) }

switch ($Action.ToLowerInvariant()) {
  "setup" { npm ci; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; npm test; break }
  "readiness" { npm run live:readiness:ping; break }
  "webhook" { npm run paypal:webhook; break }
  "daemon" { npm run autonomous:daemon; break }
  "once" { npm run autonomous:once; break }
  "shell" { Write-Host "Environment is set in this window."; break }
  default { Write-Host ("Unknown action: " + $Action); Write-Host "Actions: setup, readiness, webhook, daemon, once, shell"; break }
}
