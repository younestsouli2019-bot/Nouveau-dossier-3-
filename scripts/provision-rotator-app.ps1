<#
.SYNOPSIS
  Bootstrap the CENTRAL_ROTATOR GitHub App secrets consumed by
  .github/workflows/crypto-address-rotation.yml.

.DESCRIPTION
  Until CENTRAL_ROTATOR_APP_ID and CENTRAL_ROTATOR_PRIVATE_KEY exist as repo
  secrets, that workflow degrades to read-only and every address rotation stays
  fail-closed. This script provisions the pair, then proves it works:

    1. stores both secrets (value piped on stdin, never on the command line,
       so nothing leaks into shell history or the process argument table);
    2. mints a 1h App installation token, which proves the App ID and the PEM
       belong together and that the App is actually installed on the repo;
    3. reads /actions/secrets/public-key with that token, which proves the App
       carries the "Secrets: read" permission.

  It cannot prove "Secrets: write" without mutating a secret, so the last line
  printed is the exact command that closes the loop.

  RUN OUTSIDE TRAE (Admin PowerShell or GitHub Desktop shell): the IDE sandbox
  blocks the credential write path (NG6), and gh must be authenticated there.

  ASCII-only on purpose: PowerShell 5.1 reads BOM-less .ps1 files as ANSI, so a
  non-ASCII byte here would break parsing on the host that actually runs it.

.EXAMPLE
  pwsh -File scripts/provision-rotator-app.ps1
  pwsh -File scripts/provision-rotator-app.ps1 -AppId 4747326 -PemPath C:\keys\swarm-rotator.pem
#>
[CmdletBinding()]
param(
  [string]$Repo = 'younestsouli2019-bot/Nouveau-dossier-3-',
  [string]$AppId,
  [string]$PemPath
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$headers = @{
  Authorization          = ''
  Accept                 = 'application/vnd.github+json'
  'X-GitHub-Api-Version' = '2022-11-28'
}
$pemTempFile = $null

function Fail([string]$Message) {
  Write-Error "[ROTATOR-APP] $Message"
  exit 1
}

try {
  # ---------------------------------------------------------------- Preflight
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Fail "GitHub CLI 'gh' not found. Install it, then run 'gh auth login'."
  }
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Fail 'node not found on PATH.'
  }

  # gh writes its failure to stderr; under ErrorActionPreference=Stop a merged
  # redirect turns that into a terminating error with a confusing trace. Probe
  # the exit code with the preference relaxed, then restore it.
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'SilentlyContinue'
  & gh auth status > $null 2>&1
  $ghAuthenticated = ($LASTEXITCODE -eq 0)
  $ErrorActionPreference = $prevEap
  if (-not $ghAuthenticated) {
    Fail "gh is not authenticated. Run 'gh auth login' (outside Trae), then re-run."
  }

  $mintScript = Join-Path $root 'scripts\mint-app-token.mjs'
  if (-not (Test-Path -LiteralPath $mintScript)) {
    Fail "missing $mintScript - refusing to write secrets we cannot verify."
  }

  Write-Host "[ROTATOR-APP] repo=$Repo"

  # ------------------------------------------------- Inputs (never echoed)
  if (-not $AppId) {
    $AppId = (Read-Host -Prompt 'GitHub App ID (numeric, from the App settings page)').Trim()
  }
  if ($AppId -notmatch '^\d+$') { Fail "App ID must be numeric (got '$AppId')." }

  if (-not $PemPath) {
    $PemPath = (Read-Host -Prompt 'Path to the App private key .pem (generated in GitHub App settings)').Trim().Trim('"')
  }
  if (-not (Test-Path -LiteralPath $PemPath)) { Fail "PEM not found at '$PemPath'." }

  $pem = [System.IO.File]::ReadAllText($PemPath)
  if ($pem -notmatch 'PRIVATE KEY') { Fail 'that file does not look like a PEM private key.' }

  # ------------------- Stage 1: write both secrets, value on stdin (no argv)
  $AppId | & gh secret set CENTRAL_ROTATOR_APP_ID --repo $Repo
  if ($LASTEXITCODE -ne 0) { Fail 'failed to write CENTRAL_ROTATOR_APP_ID.' }
  Write-Host '[ROTATOR-APP] CENTRAL_ROTATOR_APP_ID written.'

  $pem | & gh secret set CENTRAL_ROTATOR_PRIVATE_KEY --repo $Repo
  if ($LASTEXITCODE -ne 0) { Fail 'failed to write CENTRAL_ROTATOR_PRIVATE_KEY.' }
  Write-Host '[ROTATOR-APP] CENTRAL_ROTATOR_PRIVATE_KEY written.'

  # ------------------------------------------- Stage 2: presence check
  $listed = (& gh secret list --repo $Repo) -join "`n"
  foreach ($name in 'CENTRAL_ROTATOR_APP_ID', 'CENTRAL_ROTATOR_PRIVATE_KEY') {
    if ($listed -notmatch [regex]::Escape($name)) { Fail "$name is not listed after the write." }
  }
  Write-Host '[ROTATOR-APP] both secrets present in the repo secret store.'

  # ------- Stage 3: prove the pair mints a token and carries Secrets:read
  # The PEM goes to the OS temp dir as UTF-8 without BOM, then is deleted in the
  # finally block - it never touches the working tree.
  $pemTempFile = Join-Path $env:TEMP ('rotator-' + [guid]::NewGuid().ToString('N') + '.pem')
  [System.IO.File]::WriteAllText($pemTempFile, $pem, (New-Object System.Text.UTF8Encoding($false)))

  $env:GITHUB_APP_ID = $AppId
  $env:GITHUB_APP_PRIVATE_KEY_PATH = $pemTempFile
  $token = (& node $mintScript).Trim()
  Remove-Item Env:\GITHUB_APP_ID -ErrorAction SilentlyContinue
  Remove-Item Env:\GITHUB_APP_PRIVATE_KEY_PATH -ErrorAction SilentlyContinue

  if (-not $token -or $token -notmatch '^ghs_') {
    Fail "the App could not mint an installation token - App ID / PEM mismatch, or the App is not installed on $Repo."
  }
  Write-Host '[ROTATOR-APP] App token minted (1h) - ID + PEM + installation verified.'

  $headers.Authorization = "Bearer $token"
  $pk = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/actions/secrets/public-key" -Headers $headers -Method Get
  if (-not $pk.key_id) { Fail "public-key read returned no key_id - the App likely lacks Secrets:read." }
  Write-Host '[ROTATOR-APP] Secrets:read verified (key_id present, value never printed).'

  # ---------------------------------------------------------------- Hand-off
  Write-Host ''
  Write-Host '[ROTATOR-APP] Done. ONE thing remains, and it is the only way to prove Secrets:write:'
  Write-Host "[ROTATOR-APP]   gh workflow run crypto-address-rotation.yml --repo $Repo -f dry_run=false"
  Write-Host '[ROTATOR-APP] then confirm the Execute rotation step ran (not can_execute=false).'
}
finally {
  if ($pemTempFile -and (Test-Path -LiteralPath $pemTempFile)) {
    Remove-Item -LiteralPath $pemTempFile -Force -ErrorAction SilentlyContinue
  }
  Remove-Item Env:\GITHUB_APP_ID -ErrorAction SilentlyContinue
  Remove-Item Env:\GITHUB_APP_PRIVATE_KEY_PATH -ErrorAction SilentlyContinue
}
