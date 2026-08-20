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
