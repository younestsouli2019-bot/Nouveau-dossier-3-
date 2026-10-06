<#
.SYNOPSIS
S3-T02: History scrub (git filter-repo --invert-paths) per separate file for auditability.
DRY-RUN is the DEFAULT (just prints plan). Use -Force AND a physical session (ALL Trae windows closed)
combined with push-outside-sandbox-v358.ps1 AFTER scrub as per NG6 Sandbox constraints.

Signataire-only execution. Robot never runs with -Force.
#>
[CmdletBinding()]
param(
    [switch]$Force
)
$ErrorActionPreference = "Stop"
$REPO = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$DRY = -not $Force.IsPresent

$SENSITIVE_PATHS_REMOVE = @(
    <# PDF evidence / legal huissier (per S3 P0) #>
    "audit/legal/HUISSIER_MANDAT_INFO_SECURE.pdf"
    <# Operational state/PS1 files with vault sync details tracked accidentally in early commits #>
    "reports/secrets-payouts/00_final_master.json"
    "reports/secrets-payouts/02_push_runbook.md"
    "reports/secrets-payouts/08_integrity_hmac.md"
)

Write-Host "=== S3-T02 scrub-history (DRY-RUN=$DRY) NG6 Sandbox notice ==="
Write-Host "Signataire-only: WITH -Force (1) close ALL Trae IDE windows first; (2) open elevated standalone PS1; (3) run this with -Force; (4) run push-outside-sandbox-v358.ps1 afterward."
Write-Host "Repo: $REPO`n"

if ($DRY) {
    foreach ($p in $SENSITIVE_PATHS_REMOVE) {
        Write-Host "[DRY plan invocations — SEPARATE per-file filter-repo for auditability]:"
        Write-Host "   1) git filter-repo --force --invert-paths --path '$p'"
        Write-Host "   2) post: git reflog expire --expire=now --all && git gc --prune=now --aggressive"
        Write-Host "   3) VERIFY: 30 random historical commits cat-file -p blob SHAs -> grep for bank refs 0xA462|00888|RIB.*372|Agdal.*018|HUA-2026-RBT should produce count=0"
        Write-Host ""
    }
    Write-Host "[DRY EXIT 0] Signataire: run with -Force from standalone admin PowerShell after closing Trae fully."
    exit 0
}
else {
    # signataire -Force path
    if ($env:TRAE_TERM_ID -or $env:VSCODE_GIT_IPC_HANDLE -or $env:TERM_PROGRAM -eq "vscode") {
        Write-Error "NG6 Sandbox violation: -Force history rewrite cannot run inside IDE. Exit all Trae/VSCode windows, use standalone admin PS1 only."
        exit 49
    }
    Push-Location $REPO
    try {
        foreach ($p in $SENSITIVE_PATHS_REMOVE) {
            Write-Host "Removing '$p' from ENTIRE history (SEPERATE filter-repo call per-file for auditability)..."
            if (-not (Get-Command git-filter-repo -ErrorAction SilentlyContinue)) {
                Write-Error "git-filter-repo not on PATH (pip install git-filter-repo + python3.9+ required). ABORT."
                exit 3
            }
            & git filter-repo --force --invert-paths --path $p
            if ($LASTEXITCODE -ne 0) { Write-Error "filter-repo failed on $p"; exit $LASTEXITCODE }
        }
        Write-Host "Running reflog expire + gc aggressive..."
        & git reflog expire --expire=now --all
        & git gc --prune=now --aggressive
        Pop-Location
        Write-Host "SCRUB SUCCESS. Next (a) audit 30 commits via audit-tracked-sensitive (b) paste new rotated creds (c) push-outside-sandbox-v358.ps1"
        exit 0
    } catch {
        Pop-Location
        Write-Error "Force scrub failed: $($_.Exception.Message)"
        exit 7
    }
}
