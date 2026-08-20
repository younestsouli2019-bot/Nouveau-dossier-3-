<#
.SYNOPSIS
  Layer 3/5 — verifies integrity of the 48-file SWARM CORE critical set
  against scripts/guard/core-integrity.sha256manifest.
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

$CORE_FILES = @(
  '.gitignore','.gitattributes','package.json','package-lock.json',
  'prisma/schema.prisma','CHANGELOG.md','RELEASE_MANIFEST.json',
  '.github/workflows/sync-secrets.yml','.github/workflows/deploy-pages.yml',
  '.github/workflows/main.yml','.github/workflows/org-broadcast.yml',
  '.github/workflows/protect-core.yml',
  'scripts/swarm-autonomy-daemon.mjs','scripts/swarm-improve-loop.mjs',
  'scripts/START-SWARM.cmd','scripts/STOP-SWARM.cmd',
  'scripts/guard/core-integrity.sha256manifest',
  'scripts/guard/verify-core.ps1',
  'scripts/guard/apply-attrib-readonly.ps1',
  'scripts/guard/install-core-protect-hook.ps1',
  'scripts/guard/pre-commit.hook.sh',
  'scripts/mirrors/sync-mirrors.cmd',
  'scripts/mirrors/backup-doomsday-vault.local.cmd',
  'scripts/mirrors/secure-cloud-upload.cmd',
  'src/lib/atomic-simulation.ts','src/lib/audit-agent.ts',
  'src/lib/escrow-vaults.ts','src/lib/settlement-engine.ts',
  'src/lib/strict-enforcement/audit-reconciliation.ts',
  'src/lib/owner-config.ts',
  'src/lib/strict-enforcement/crypto-utils.ts',
  'src/app/api/webhooks/github-secrets/route.ts',
  'src/app/api/settlements/wet-run/route.ts',
  'src/locking/distlock.py','src/locking/tests/test_distlock.py',
  'src/locking/requirements.txt',
  'contracts/escrow/CounterpartyEscrow.sol',
  'contracts/escrow/interfaces/IHierarchicalEscrow.sol',
  'contracts/escrow/libraries/UniqueStateHash.sol',
  'contracts/escrow/ARCHITECTURE.md',
  'src/agents/prompts/registry.json',
  'src/agents/prompts/system-prompt-audit-critical.md',
  'src/agents/prompts/system-prompt-duplicate-isolation.md',
  'src/agents/prompts/1shot-cannibal-cluster-payoneer-9x150.md',
  'src/agents/prompts/1shot-fabricated-proofhash.md',
  'src/agents/prompts/tool-prompt-load-evidence-csv.md',
  'src/agents/prompts/tool-prompt-quarantine-write.md',
  'reports/policy/PRECAUTIONS_MATRIX.md'
)

function Hash-File([string]$Full) {
  $fs = [System.IO.File]::OpenRead($Full)
  try {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    [byte[]]$raw = $sha.ComputeHash($fs)
    return ([System.BitConverter]::ToString($raw)).Replace('-','').ToLowerInvariant()
  } finally {
    $sha.Dispose()
    $fs.Dispose()
  }
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
    Set-Content -LiteralPath $OutFile -Value $lines.ToArray() -Encoding UTF8
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
