<#
.SYNOPSIS
  Layer 3/5 — verifies integrity of the SWARM CORE critical set against
  scripts/guard/core-integrity.sha256manifest. The set itself is read from the
  single canonical allowlist scripts/guard/core-files.txt, so it is no longer
  duplicated here.
.DESCRIPTION
  On first run (or whenever -Init is passed), re-computes SHA-256 of every
  CORE file and writes the signed + dated manifest to
  scripts/guard/core-integrity.sha256manifest (which is itself CORE, so
  both .gitattributes and pre-commit also protect it).
  On normal runs (no flag), loads the manifest and re-hashes every listed
  file. Exits 0 if EVERY hash matches. Exits 1 (with a table of mismatches
  + a suggestion to re -Init if intentional) on ANY mismatch or missing
  file or missing manifest.
  Because this script runs from GitHub Actions as well as locally, any
  accidental overwrite from a rogue worktree push (like 2762682c10 upslawis
  this morning) is detected both locally and on CI before Pages / Vercel
  deployments can proceed.
.PARAMETER Init
  Re-generate core-integrity.sha256manifest. Use ONLY after a deliberate
  [CORE-UPDATE] change.
.PARAMETER OutFile
  Override manifest path (default: scripts/guard/core-integrity.sha256manifest)
#>

[CmdletBinding()]
param(
  [switch]$Init,
  [string]$OutFile
)

$ErrorActionPreference = 'Stop'

$repoRoot  = Split-Path -Parent $PSScriptRoot
$repoRoot  = Split-Path -Parent $repoRoot
if ([string]::IsNullOrWhiteSpace($OutFile)) {
  $OutFile = Join-Path $PSScriptRoot 'core-integrity.sha256manifest'
}

# The CORE allowlist lives in exactly ONE place: scripts/guard/core-files.txt.
# Do not inline a copy here -- the pre-commit hook, apply-attrib-readonly.ps1
# and sync-core-guards.ps1 all read that same file, and CI fails on drift.
$coreListFile = Join-Path $PSScriptRoot 'core-files.txt'
if (-not (Test-Path -LiteralPath $coreListFile)) {
  throw ("[verify-core] FAIL-CLOSED: canonical CORE list missing: " + $coreListFile)
}
$CORE_FILES = @(
  Get-Content -LiteralPath $coreListFile |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ -ne '' -and -not $_.StartsWith('#') }
)
if ($CORE_FILES.Count -eq 0) {
  throw ("[verify-core] FAIL-CLOSED: canonical CORE list is empty: " + $coreListFile)
}

function Hash-File([string]$Full) {
  # Hash the LF-normalised bytes, not the raw working-tree bytes.
  # git stores every CORE text file LF-only in the index (see `* text=auto`),
  # so a Windows checkout (core.autocrlf=true -> CRLF) and the Linux CI
  # checkout (LF) would otherwise hash the SAME committed file to DIFFERENT
  # SHA-256 values, and a manifest blessed on Windows could never pass on CI.
  # Dropping CR that immediately precedes LF reproduces the index bytes.
  # Every CORE entry is a text file; a binary CORE file would need `-text`.
  $bytes = [System.IO.File]::ReadAllBytes($Full)
  $norm  = New-Object System.Collections.Generic.List[byte] ($bytes.Length)
  for ($i = 0; $i -lt $bytes.Length; $i++) {
    if ($bytes[$i] -eq 13 -and ($i + 1) -lt $bytes.Length -and $bytes[$i + 1] -eq 10) { continue }
    $norm.Add($bytes[$i])
  }
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    [byte[]]$raw = $sha.ComputeHash($norm.ToArray())
  } finally {
    $sha.Dispose()
  }
  return ([System.BitConverter]::ToString($raw)).Replace('-','').ToLowerInvariant()
}

Push-Location $repoRoot
try {
  if ($Init) {
    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add(('# swarm-core integrity manifest — generated ' + ([DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ'))))
    $lines.Add(('# files=' + $CORE_FILES.Count + '  algorithm=SHA-256  encoding=hex  path-base=repo-root'))
    $lines.Add('# Re-generate with: powershell -File scripts/guard/verify-core.ps1 -Init')
    $lines.Add('# Protect this file from write via: attrib +R scripts/guard/core-integrity.sha256manifest')
    foreach ($rel in $CORE_FILES) {
      $full = Join-Path $repoRoot $rel
      if (-not (Test-Path $full)) {
        Write-Warning ("[verify-core -Init] CORE file missing, writing NULL sha: " + $rel)
        $hash = '0000000000000000000000000000000000000000000000000000000000000000'
      } else {
        $hash = Hash-File $full
      }
      $lines.Add(($hash + '  ' + $rel))
    }
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllLines($OutFile, $lines.ToArray(), $utf8NoBom)
    Write-Host ("[verify-core] wrote manifest: " + $OutFile + "  entries=" + $CORE_FILES.Count)
    exit 0
  }

  if (-not (Test-Path $OutFile)) {
    Write-Host ("[verify-core] FAIL: manifest missing at " + $OutFile)
    Write-Host "Run one of:"
    Write-Host "   powershell -File scripts\guard\verify-core.ps1 -Init"
    exit 1
  }

  $expected = @{}
  foreach ($line in Get-Content $OutFile) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    if ($line.TrimStart().StartsWith('#')) { continue }
    $hash = $line.Substring(0, 64)
    $rel  = $line.Substring(64).Trim()
    $expected[$rel] = $hash
  }

  $bad = 0
  $manifestRel = 'scripts/guard/core-integrity.sha256manifest'
  foreach ($rel in $CORE_FILES) {
    $full = Join-Path $repoRoot $rel
    if (-not (Test-Path $full)) {
      Write-Host ("MISS   " + $rel)
      $bad++
      continue
    }
    if ($rel -eq $manifestRel) {
      Write-Verbose ("manifest self-hash skipped -- present, not self-verifying: " + $rel)
      continue
    }
    $actual = Hash-File $full
    $want   = $expected[$rel]
    if ($want -ne $actual) {
      Write-Host ("MISMATCH  " + $rel + "  want=" + $want + "  actual=" + $actual)
      $bad++
    } else {
      Write-Verbose ("OK    " + $rel)
    }
  }

  if ($bad -eq 0) {
    Write-Host ("[verify-core] PASS -- " + $CORE_FILES.Count + " CORE files, ALL hashes match.")
    exit 0
  } else {
    Write-Host ("[verify-core] FAIL -- " + $bad + " CORE files mismatched / missing.")
    Write-Host "If intentional, run:"
    Write-Host "   powershell -File scripts\guard\verify-core.ps1 -Init"
    exit 1
  }
} finally {
  Pop-Location
}
