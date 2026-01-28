param(
  [Parameter(Mandatory = $true)]
  [string]$Org,
  [string]$Visibility = "all",
  [string]$CredsPath = "CREDS.txt"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $root | Out-Null

$gh = Get-Command gh -ErrorAction SilentlyContinue
if (-not $gh) { throw "Missing GitHub CLI 'gh'. Install and run 'gh auth login'." }

function LoadCreds([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return @() }
  return Get-Content -LiteralPath $path -ErrorAction Stop
}

function ExtractPairs([string[]]$lines) {
  $pairs = @{}
  foreach ($l in $lines) {
    $t = $l.Trim()
    if (-not $t) { continue }
    if ($t -match '^\s*\$env\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$') {
      $name = $Matches[1].Trim()
      $v = $Matches[2].Trim().Trim('"').Trim("'")
      if (-not $name) { continue }
      if (-not $v) { continue }
      if ($v -match "^\s*<\s*YOUR_[A-Z0-9_]+\s*>\s*$") { continue }
      if ($v -match "^\s*YOUR_[A-Z0-9_]+\s*$") { continue }
      if ($v -match "^\s*(REPLACE_ME|CHANGEME|TODO)\s*$") { continue }
      $pairs[$name] = $v
    }
  }
  return $pairs
}

$lines = LoadCreds (Join-Path $root $CredsPath)
$pairs = ExtractPairs $lines

if ($pairs.Keys.Count -eq 0) { Write-Host "No env pairs found in CREDS.txt"; exit 0 }

foreach ($k in $pairs.Keys) {
  $v = $pairs[$k]
  $args = @("secret", "set", $k, "--org", $Org, "--visibility", $Visibility, "--body", $v)
  & gh @args
  if ($LASTEXITCODE -ne 0) { throw ("Failed to set secret " + $k) }
}

Write-Host ("SYNCED=" + $pairs.Keys.Count)
