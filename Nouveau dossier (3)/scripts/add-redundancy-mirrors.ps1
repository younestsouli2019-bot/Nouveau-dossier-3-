#Requires -Version 5
<#
.SYNOPSIS
  Idempotently adds OPTIONAL push/fetch remotes for repo redundancy
  (GitLab, Codeberg, secure-cloud). GitHub primary remains origin.

.DESCRIPTION
  Settlements WET-RUN does NOT rely on this script — it is purely for the
  optional redundancy the user asked for on 2026-08-13 ("if necessary make
  repo mirrors in https://about.gitlab.com/ or Codeberg or if swarm already
  has secure-cloud, disregard this").

  Existing redundancy layers that ALREADY ship with the swarm:
    - GitHub primary   (origin / https-origin)
    - .keys/           DID signing keys (PEM pairs, offline copies)
    - .swarm/          daemon recovery + contingency state
    - .base44-offline-store.json  offline Base44 vault mirror
    - 8-hour in-memory TTL vault (secure-vault.ts) with key-only audit

  If those layers are sufficient for you, simply do NOT run this script.

  If you want an EXTRA remote (GitLab SaaS / Codeberg / your own on-prem
  secure-cloud), edit the hashtable at the top of this file OR pass the
  corresponding env vars, then run:

    powershell -ExecutionPolicy Bypass -File .\scripts\add-redundancy-mirrors.ps1

  After running, mirror a single push with:

    git push --mirror gitlab      (or codeberg / secure-cloud)

  Or set up multi-push default (NOT recommended — this script does NOT do
  multi-push automatically to avoid accidental secret-broadcast).

.NOTES
  Never commit actual tokens. Repo URLs should be HTTPS (with a PAT stored in
  Git Credential Manager via GitHub Desktop) or SSH.
#>

[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [switch]$ShowOnly
)

$ErrorActionPreference = 'Stop'

# ─── Optional remote definitions ─────────────────────────────────────────────
# Edit here OR set env vars before running. If Value is empty/null → skipped.
# Name format: <remote-name> = <git-remote-url>
$REMOTES = [ordered]@{
  gitlab       = $env:SWARM_MIRROR_GITLAB_URL       # e.g. "https://gitlab.com/<your-user>/<repo>.git"
  codeberg     = $env:SWARM_MIRROR_CODEBERG_URL     # e.g. "https://codeberg.org/<your-user>/<repo>.git"
  secure_cloud = $env:SWARM_MIRROR_SECURECLOUD_URL  # on-prem / air-gap / second GitHub org / swarm secure-cloud
}

$Git = Join-Path $env:ProgramFiles 'Git\bin\git.exe'
if (-not (Test-Path $Git)) { $Git = 'git.exe' }

function Invoke-Git {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
  & $Git @Args 2>&1 | Out-String
}

Write-Host "= Redundancy mirror remote setup (optional, idempotent)" -ForegroundColor Cyan
Write-Host "  Primary  : $(Invoke-Git remote get-url origin)"
Write-Host "  Https-opt: $(Invoke-Git remote get-url https-origin 2>$null)"
Write-Host ""

$anyAdded = $false
foreach ($k in $REMOTES.Keys) {
  $url = $REMOTES[$k]
  if ([string]::IsNullOrWhiteSpace($url)) {
    Write-Host "  SKIP  $k  — no URL configured (env:SWARM_MIRROR_$(($k.ToUpper() -replace '_',''))_URL or edit script)"
    continue
  }
  $existing = Invoke-Git remote get-url $k 2>$null
  if (-not [string]::IsNullOrWhiteSpace($existing)) {
    $existing = $existing.Trim()
    if ($existing -eq $url) {
      Write-Host "  OK    $k  already set → $url"
      continue
    } else {
      if ($PSCmdlet.ShouldProcess("remote $k", "set-url $url")) {
        $null = Invoke-Git remote set-url $k $url
        Write-Host "  UPD   $k  → $url"
        $anyAdded = $true
      }
    }
  } else {
    if ($PSCmdlet.ShouldProcess("remote $k", "add $url")) {
      $null = Invoke-Git remote add $k $url
      Write-Host "  ADD   $k  → $url"
      $anyAdded = $true
    }
  }
}

Write-Host ""
if ($anyAdded) {
  Write-Host "Remotes added. Next steps:"
  Write-Host "  1. Open Git Desktop → Repository → Pull to make sure local is clean."
  Write-Host "  2. From command line (example GitLab mirror):"
  Write-Host "       git push --mirror gitlab"
  Write-Host "       git push --mirror codeberg"
  Write-Host "  3. To ALWAYS back up after pushes to origin, use `post-push` hook (not auto-set by this script)."
} else {
  Write-Host "No new remotes were added (none configured). Existing redundancy layers remain in effect."
}
