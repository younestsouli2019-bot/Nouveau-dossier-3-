<#
.SYNOPSIS
  Layer 5/5 — filesystem-level read-only bit (+R) applied to the SWARM CORE
  critical file set using attrib.exe on Windows /S... well.
.DESCRIPTION
  Even with pre-commit hooks, .gitattributes -merge and CI gating, a
  sufficiently confused user or a rogue drag-and-drop in Explorer can still overwrite a
  file if it's owned by the same user account in the filesystem. This script calls
  attrib +R on every CORE file (equivalent. Explorer "Read-Only. Default
  attribute. To legitimately edit a file, pass -Clear (unset +R before editing. When
  done, run this script again. This is safe against
.EXAMPLE
  .\apply-attrib-readonly.ps1 -Clear
    Clear the read-only bit before editing.
#>

[CmdletBinding()]
param(
  [switch]$Clear
)

$ErrorActionPreference = 'Stop'

$repoRoot  = Split-Path -Parent $PSScriptRoot
$repoRoot  = Split-Path -Parent $repoRoot

# Single source of truth: scripts/guard/core-files.txt -- no inlined copy.
$coreListFile = Join-Path $PSScriptRoot 'core-files.txt'
if (-not (Test-Path -LiteralPath $coreListFile)) {
  throw ("[attrib] FAIL-CLOSED: canonical CORE list missing: " + $coreListFile)
}
$CORE_FILES = @(
  Get-Content -LiteralPath $coreListFile |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ -ne '' -and -not $_.StartsWith('#') }
)
if ($CORE_FILES.Count -eq 0) {
  throw ("[attrib] FAIL-CLOSED: canonical CORE list is empty: " + $coreListFile)
}

$flag = if ($Clear) { '-R' } else { '+R' }
$ok = 0
$miss = 0
foreach ($rel in $CORE_FILES) {
  $full = Join-Path $repoRoot $rel
  if (-not (Test-Path $full)) { $miss++; continue }
  & attrib.exe $flag $full 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $ok++ } else { Write-Warning ("attrib failed: " + $rel) }
}
Write-Host ("[attrib] CORE files: attrib $flag  ok=$ok  missing=$miss  total=$($CORE_FILES.Count)")
if (-not $Clear) {
  Write-Host "[attrib] To edit one file legitimately, run:  attrib -R <path>"
  Write-Host "[attrib] (or run this script with -Clear, then rerun after the commit.)"
}
