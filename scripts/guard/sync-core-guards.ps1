<#
.SYNOPSIS
  Layer 4/5 helper -- generates (or drift-checks) the SWARM CORE block inside
  .gitattributes from the single canonical allowlist scripts/guard/core-files.txt.
.DESCRIPTION
  The CORE allowlist used to be duplicated across four files, so every change
  had to be applied four times and could silently drift apart. It now lives
  only in scripts/guard/core-files.txt; this script projects it into
  .gitattributes as a "-merge" guard block.
  Every CORE path carries "-merge" (the merge attribute set to unset), so git
  refuses to auto-resolve any of them when BOTH sides changed. It surfaces as a
  conflict that must be resolved deliberately, which closes the "rogue worktree
  push quietly overwrote a protected file" failure mode (2026-08-20,
  commit 2762682c10) that the other layers can only detect once the git object
  has already been written.
  Only the region between the BEGIN and END markers is touched; everything else
  in .gitattributes (the LFS lines, * text=auto) is preserved verbatim.
.PARAMETER Check
  Do not write. Exit 1 if the block in .gitattributes does not match
  core-files.txt exactly, so CI can gate on drift.
.EXAMPLE
  pwsh scripts/guard/sync-core-guards.ps1
  pwsh scripts/guard/sync-core-guards.ps1 -Check
#>

[CmdletBinding()]
param(
  [switch]$Check
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $repoRoot
$listFile = Join-Path $PSScriptRoot 'core-files.txt'
$attrFile = Join-Path $repoRoot       '.gitattributes'

$BEGIN = '# ==== SWARM CORE (generated from scripts/guard/core-files.txt) BEGIN ===='
$END   = '# ==== SWARM CORE END ===='

if (-not (Test-Path -LiteralPath $listFile)) {
  throw ("[sync-core-guards] FAIL-CLOSED: canonical CORE list missing: " + $listFile)
}
if (-not (Test-Path -LiteralPath $attrFile)) {
  throw ("[sync-core-guards] FAIL-CLOSED: .gitattributes missing: " + $attrFile)
}

$coreFiles = @(
  Get-Content -LiteralPath $listFile |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ -ne '' -and -not $_.StartsWith('#') }
)
if ($coreFiles.Count -eq 0) {
  throw ("[sync-core-guards] FAIL-CLOSED: canonical CORE list is empty: " + $listFile)
}
foreach ($rel in $coreFiles) {
  if ($rel -match '\s') {
    throw ("[sync-core-guards] FAIL-CLOSED: path contains whitespace, cannot emit a -merge line: " + $rel)
  }
}

$block = New-Object System.Collections.Generic.List[string]
$block.Add($BEGIN)
$block.Add('# Do NOT edit by hand -- rebuild with: pwsh scripts/guard/sync-core-guards.ps1')
$block.Add('# Source of truth: scripts/guard/core-files.txt (rationale + process documented there)')
$block.Add('# Layer 4/5: "-merge" makes git refuse to auto-resolve a CORE file that BOTH')
$block.Add('# sides changed -- it surfaces as a conflict instead of a silent merge.')
foreach ($rel in $coreFiles) { $block.Add($rel + ' -merge') }
$block.Add($END)

# Read .gitattributes as LF-normalised lines.
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$raw   = [System.IO.File]::ReadAllText($attrFile, $utf8NoBom)
$lines = @($raw -split "`n" | ForEach-Object { $_.TrimEnd("`r") })
if ($lines.Count -gt 0 -and $lines[$lines.Count - 1] -eq '') {
  $lines = @($lines[0..($lines.Count - 2)])
}

$beginIdx = -1
$endIdx   = -1
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($beginIdx -lt 0 -and $lines[$i].Trim() -eq $BEGIN) { $beginIdx = $i; continue }
  if ($beginIdx -ge 0 -and $lines[$i].Trim() -eq $END)   { $endIdx   = $i; break }
}

if ($beginIdx -lt 0) {
  throw ("[sync-core-guards] FAIL-CLOSED: BEGIN marker not found in .gitattributes.`n  expected: " + $BEGIN + "`n  Insert the BEGIN/END marker pair once, then re-run.")
}
if ($endIdx -lt 0) { $endIdx = $lines.Count - 1 }

$before = @()
if ($beginIdx -gt 0) { $before = @($lines[0..($beginIdx - 1)]) }
$after = @()
if ($endIdx -lt ($lines.Count - 1)) { $after = @($lines[($endIdx + 1)..($lines.Count - 1)]) }
$current = @($lines[$beginIdx..$endIdx])

if ($Check) {
  $drift = ($block.Count -ne $current.Count)
  if (-not $drift) {
    for ($i = 0; $i -lt $block.Count; $i++) {
      if ($block[$i] -ne $current[$i]) { $drift = $true; break }
    }
  }
  if ($drift) {
    Write-Host "[sync-core-guards] DRIFT -- the .gitattributes CORE block does not match scripts/guard/core-files.txt"
    Write-Host ("  canonical: " + $block.Count + " lines    in .gitattributes: " + $current.Count + " lines")
    # Compare-Object rather than an index walk: one inserted line shifts every
    # following line, which would otherwise dump the whole list as a "diff".
    $co = Compare-Object -ReferenceObject $block.ToArray() -DifferenceObject $current -SyncWindow 20
    foreach ($d in $co) {
      $tag = if ($d.SideIndicator -eq '<=') { 'only in core-files.txt' } else { 'only in .gitattributes' }
      Write-Host ("  " + $tag + ": " + $d.InputObject)
    }
    Write-Host "Fix: pwsh scripts/guard/sync-core-guards.ps1   then   pwsh scripts/guard/verify-core.ps1 -Init"
    exit 1
  }

  # Liveness: the consumers must actually READ the canonical list. Without this
  # a future edit could re-inline a private copy of the allowlist -- which would
  # still produce a matching .gitattributes block, but would silently drift again
  # the moment anything else changed.
  $consumers = @(
    'scripts/guard/verify-core.ps1',
    'scripts/guard/commit-msg.hook.sh',
    'scripts/guard/apply-attrib-readonly.ps1'
  )
  $problems = @()
  foreach ($rel in $consumers) {
    $p = Join-Path $repoRoot $rel
    if (-not (Test-Path -LiteralPath $p)) {
      $problems += ($rel + '  ->  MISSING')
      continue
    }
    if ([System.IO.File]::ReadAllText($p) -notmatch 'core-files\.txt') {
      $problems += ($rel + '  ->  does not reference core-files.txt (inlined copy?)')
    }
  }
  if ($problems.Count -gt 0) {
    Write-Host "[sync-core-guards] FAIL -- CORE consumer(s) no longer read the canonical list:"
    foreach ($p in $problems) { Write-Host ("  " + $p) }
    exit 1
  }

  Write-Host ("[sync-core-guards] PASS -- .gitattributes block + 3 consumers agree with core-files.txt (" + $coreFiles.Count + " entries).")
  exit 0
}

$out = New-Object System.Collections.Generic.List[string]
foreach ($l in $before)  { $out.Add($l) }
foreach ($l in $block)   { $out.Add($l) }
foreach ($l in $after)   { $out.Add($l) }

[System.IO.File]::WriteAllText($attrFile, (($out.ToArray() -join "`n") + "`n"), $utf8NoBom)
Write-Host ("[sync-core-guards] wrote .gitattributes CORE block: " + $coreFiles.Count + " '-merge' entries.")
exit 0
