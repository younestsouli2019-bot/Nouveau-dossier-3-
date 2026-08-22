<#
.SYNOPSIS
  Installs or uninstalls the CORE-PROTECT pre-commit hook for this repo.
.DESCRIPTION
  On install: copies scripts/guard/pre-commit.hook.sh -> .git/hooks/pre-commit
  and attempts to chmod +x it (via Git Bash / WSL sh.exe on PATH). On Windows
  this is usually already fine because Git for Windows invokes hooks through
  its bundled MSYS sh regardless of the +x bit.
  On uninstall: deletes the pre-commit hook file.
.PARAMETER Uninstall
  If set, removes .git/hooks/pre-commit instead of installing it.
#>

[CmdletBinding()]
param(
  [Alias('U')] [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

$repoRoot  = Split-Path -Parent $PSScriptRoot
$repoRoot  = Split-Path -Parent $repoRoot  # scripts/guard -> repo root
$gitDir    = Join-Path $repoRoot '.git'
if (-not (Test-Path $gitDir)) {
  # Not at expected layout; allow running from anywhere via git rev-parse
  $gitDir = git rev-parse --git-dir 2>$null
  if ([string]::IsNullOrWhiteSpace($gitDir)) { throw "Not inside a git repo." }
  if (-not [System.IO.Path]::IsPathRooted($gitDir)) {
    $gitDir = Join-Path (Get-Location).Path $gitDir
  }
}
$hookDir  = Join-Path $gitDir 'hooks'
$hookPath = Join-Path $hookDir 'pre-commit'
$source   = Join-Path $PSScriptRoot 'pre-commit.hook.sh'

if ($Uninstall) {
  if (Test-Path $hookPath) {
    Remove-Item $hookPath -Force
    Write-Host ("[core-protect] UNINSTALLED: removed " + $hookPath)
  } else {
    Write-Host "[core-protect] (no hook present; nothing to uninstall)"
  }
  exit 0
}

New-Item -ItemType Directory -Force -Path $hookDir | Out-Null
Copy-Item -LiteralPath $source -Destination $hookPath -Force

$sh = Get-Command sh.exe -ErrorAction SilentlyContinue
if ($sh) {
  try {
    & $sh -c ('chmod +x ' + "'" + ($hookPath -replace "'","'\\''") + "'") 2>$null | Out-Null
  } catch { }
}

Write-Host "[core-protect] installed hook: $hookPath"
Write-Host "  source: scripts/guard/pre-commit.hook.sh"
Write-Host "  bypass for legitimate updates:"
Write-Host "     A.  `$env:SKIP_CORE_PROTECT=1 ; git commit ...   (local one-off)"
Write-Host "     B.  git commit -m `"[CORE-UPDATE] <section>: <reason>`"   (audited; CI also passes)"
