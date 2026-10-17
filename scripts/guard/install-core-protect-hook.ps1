<#
.SYNOPSIS
  Installs or uninstalls the CORE-PROTECT commit-msg hook for this repo.
.DESCRIPTION
  On install: writes scripts/guard/commit-msg.hook.sh -> .git/hooks/commit-msg
  with LF line endings, then attempts to chmod +x it. On Windows the +x bit is
  not what matters -- Git for Windows invokes hooks through its bundled MSYS sh
  regardless.

  This is a commit-msg hook, NOT a pre-commit hook. git runs pre-commit BEFORE
  it obtains the commit message, so a pre-commit hook can only read the PREVIOUS
  message out of .git/COMMIT_EDITMSG. That made the "[CORE-UPDATE]" tag check
  read stale data and be wrong in BOTH directions -- it let an untagged CORE
  change through whenever the previous commit happened to carry the tag, and it
  refused a correctly tagged one. commit-msg receives the path of the proposed
  message as its first argument, which is the only reliable source.

  Any legacy .git/hooks/pre-commit left by an earlier version of this script is
  removed on both install and uninstall.
.PARAMETER Uninstall
  If set, removes .git/hooks/commit-msg instead of installing it.
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
$hookDir    = Join-Path $gitDir 'hooks'
$hookPath   = Join-Path $hookDir 'commit-msg'
$legacyPath = Join-Path $hookDir 'pre-commit'
$source     = Join-Path $PSScriptRoot 'commit-msg.hook.sh'

if ($Uninstall) {
  $removed = 0
  foreach ($p in @($hookPath, $legacyPath)) {
    if (Test-Path -LiteralPath $p) {
      Remove-Item -LiteralPath $p -Force
      Write-Host ("[core-protect] UNINSTALLED: removed " + $p)
      $removed++
    }
  }
  if ($removed -eq 0) {
    Write-Host "[core-protect] (no hook present; nothing to uninstall)"
  }
  exit 0
}

New-Item -ItemType Directory -Force -Path $hookDir | Out-Null

# Copy with LF line endings. core.autocrlf=true would otherwise hand a fresh
# Windows checkout a CRLF copy of the script, and sh fails on a CRLF script
# ("\r: not found") -- which would abort EVERY commit, clean ones included.
$text = [System.IO.File]::ReadAllText($source)
$text = $text.Replace("`r`n", "`n")
[System.IO.File]::WriteAllText($hookPath, $text, (New-Object System.Text.UTF8Encoding($false)))

if (Test-Path -LiteralPath $legacyPath) {
  Remove-Item -LiteralPath $legacyPath -Force
  Write-Host ("[core-protect] removed legacy pre-commit hook (broken tag check): " + $legacyPath)
}

$sh = Get-Command sh.exe -ErrorAction SilentlyContinue
if ($sh) {
  try {
    & $sh -c ('chmod +x ' + "'" + ($hookPath -replace "'","'\\''") + "'") 2>$null | Out-Null
  } catch { }
}

Write-Host "[core-protect] installed hook: $hookPath"
Write-Host "  source: scripts/guard/commit-msg.hook.sh"
Write-Host "  bypass for legitimate updates:"
Write-Host "     A.  `$env:SKIP_CORE_PROTECT=1 ; git commit ...   (local one-off)"
Write-Host "     B.  git commit -m `"[CORE-UPDATE] <section>: <reason>`"   (audited; CI also passes)"
