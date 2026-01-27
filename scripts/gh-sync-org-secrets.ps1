param(
  [Parameter(Mandatory = $true)]
  [string]$Org,
  [string]$SecretsFile = "",
  [string]$Repos = "",
  [string]$Visibility = "all"
)

$ErrorActionPreference = "Stop"

function LoadLines([string]$path) {
  if ([string]::IsNullOrWhiteSpace($path)) { return @() }
  if (-not (Test-Path -LiteralPath $path)) { return @() }
  return Get-Content -LiteralPath $path
}

function FindCredsPath() {
  $root = (Get-Location).Path
  $p1 = Join-Path $root "CREDS.txt"
  $p2 = Join-Path $root ("Nouveau dossier (3)" + [System.IO.Path]::DirectorySeparatorChar + "CREDS.txt")
  if (Test-Path -LiteralPath $p1) { return $p1 }
  if (Test-Path -LiteralPath $p2) { return $p2 }
  return $p1
}

function IsPlaceholder([string]$v) {
  if ([string]::IsNullOrWhiteSpace($v)) { return $true }
  if ($v -match "^\s*<\s*YOUR_[A-Z0-9_]+\s*>\s*$") { return $true }
  if ($v -match "^\s*YOUR_[A-Z0-9_]+\s*$") { return $true }
  if ($v -match "^\s*(REPLACE_ME|CHANGEME|TODO)\s*$") { return $true }
  return $false
}

function ApplyEnvAssignmentsFromCreds([string[]]$lines) {
  foreach ($l in $lines) {
    $t = $l.Trim()
    if (-not $t) { continue }
    if ($t -match '^\s*\$env\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$') {
      $name = $Matches[1].Trim()
      $v = $Matches[2].Trim().Trim('"').Trim("'")
      if (-not $name) { continue }
      if (IsPlaceholder $v) { continue }
      Set-Item -Path ("Env:" + $name) -Value $v
    }
    elseif ($t -match '^([A-Za-z_][A-Za-z0-9_]*)\s*[:=]\s*(.+)$') {
      $name = $Matches[1].Trim()
      $v = $Matches[2].Trim().Trim('"').Trim("'")
      if (-not $name) { continue }
      if (IsPlaceholder $v) { continue }
      Set-Item -Path ("Env:" + $name) -Value $v
    }
  }
}

function SetOrgSecret([string]$org, [string]$name, [string]$value, [string]$repos, [string]$visibility) {
  if (IsPlaceholder $value) { return }
  if ([string]::IsNullOrWhiteSpace($value)) { return }
  $argB = "-b"
  $cmd = @("gh","secret","set",$name,"--org",$org,$argB,$value,"--visibility",$visibility,"--app","actions")
  if (-not [string]::IsNullOrWhiteSpace($repos)) {
    $cmd += @("--repos",$repos)
  }
  $res = & $cmd
}

# Preflight: gh CLI
try {
  & gh --version | Out-Null
} catch {
  throw "GitHub CLI (gh) is required. Install from https://cli.github.com/ and re-run."
}

# Load creds
$credsPath = FindCredsPath
$lines = LoadLines (if ([string]::IsNullOrWhiteSpace($SecretsFile)) { $credsPath } else { $SecretsFile })
ApplyEnvAssignmentsFromCreds $lines

# Map secrets to set at org level
$keys = @(
  "BASE44_APP_ID",
  "BASE44_SERVICE_TOKEN",
  "PAYPAL_CLIENT_ID",
  "PAYPAL_CLIENT_SECRET",
  "PAYPAL_WEBHOOK_ID",
  "OWNER_PAYPAL_EMAIL",
  "OWNER_PAYONEER_EMAIL",
  "OWNER_BENEFICIARY_NAME",
  "OWNER_IBAN",
  "OWNER_SWIFT",
  "TRUST_WALLET_ADDRESS",
  "GOOGLEPAY_ACCOUNT_EMAIL"
)

foreach ($k in $keys) {
  $v = (Get-Item -Path ("Env:" + $k) -ErrorAction SilentlyContinue).Value
  if ($null -ne $v -and -not (IsPlaceholder $v)) {
    SetOrgSecret -org $Org -name $k -value $v -repos $Repos -visibility $Visibility
  }
}
