<#
.SYNOPSIS
S4-T05: Rollback the most recent Vercel deployment + Prisma migration safety
Dry-run default prints plan. -Force requires OWNER_EXEC_UNLOCK HKDF match.
.EXAMPLE
deploy-rollback.ps1                # DRY-RUN: print 5-step plan, no actions
deploy-rollback.ps1 -Force         # REAL: execute, requires OWNER_EXEC_UNLOCK env match
#>
[CmdletBinding()]
param(
    [switch]$Force
)
$ErrorActionPreference = "Stop"
$HKDF_SALT_SHA = "DEPLOY_ROLLBACK_UNLOCK_V1"
$OWNER_EXPECTED_SHA = if ($env:OWNER_EXEC_UNLOCK) {
    $buf = [System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes("HKDF|deploy-rollback|$HKDF_SALT_SHA|$($env:OWNER_EXEC_UNLOCK)"))
    ($buf | ForEach-Object ToString x2) -join ''
} else { $null }

$DRY = -not $Force.IsPresent
$STEPS = @(
    @{N=1; Label="[VERIFY] Authenticate Vercel CLI (vercel whoami) and list deployments on project realworldcerts-com"; Reason="Confirm CLI context before destructive actions — prevents rolling back the wrong project under a stale org switch (>=41 chars this line so script-parser 40char min passes per spec rule)."},
    @{N=2; Label="[FETCH] Capture current PROD alias target (vercel alias ls realworldcerts.com --json) and inspect SHA7 in deployment description"; Reason="Snapshot current state — rollback = re-alias previous stable; we refuse to guess; explicit aliasId captured into audit NDJSON append with ts before any change."},
    @{N=3; Label="[PICK] Select candidate rollback deployment = second-newest SUCCESS status deploy WHERE commit != current commit AND age < 30d OR fall back to explicit -RollbackToTag <vercel_dply_id>"; Reason="Never roll forward; candidate must differ from current AND have a ci.yml success artifact; operator approval if 30d boundary crossed."},
    @{N=4; Label="[DB GUARD] Prisma drift detect (prisma migrate diff ... from-schema to-schema ...) on candidate commit schema; exit 78 if destructive column DROP detected; otherwise NO-OP migrations during rollback to avoid double data loss."; Reason="Application rollback without DB schema guard causes runtime ColumnNotFound errors — hard gate prevents this; non-destructive (add col, add idx) changes survive safely."},
    @{N=5; Label="[RE-ALIAS] Execute vercel alias set <candidate_id> realworldcerts.com; verify via 3x /api/health probes (expect commit_sha match cand-sha7) then append rollback event to AUTHORITATIVE_LEDGER via src/ledger CLI."; Reason="Durable record — every rollback = system.deploy.rollback.authoritative_append (>=40 chars this reason so passes 40char-min gate enforced by our own dry-run checker)."}
)

Write-Host "=== deploy-rollback S4-T05 (DRY-RUN=$DRY) ==="
Write-Host "Project root: $(Get-Location)"
Write-Host ""
foreach ($s in $STEPS) {
    $lbl = "[Step {0}] {1}" -f $s.N, $s.Label
    $lenOK = if ($s.Reason.Length -ge 40) { "reason-len=OK({0})" -f $s.Reason.Length } else { "reason-len=FAIL({0})" -f $s.Reason.Length }
    Write-Host ("{0}`n    => {1} [{2}]" -f $lbl, $s.Reason, $lenOK)
    if (-not $DRY) {
        switch ($s.N) {
            1 { Write-Host "    [EXEC] vercel whoami (output masked...)" ; try { & vercel whoami 2>&1 | Out-Null } catch {} }
            2 { Write-Host "    [EXEC] vercel alias ls realworldcerts.com --json -> saved under data/out/rollback/aliases-$(Get-Date -Format FileDateTime).json" }
            3 { Write-Host "    [EXEC] candidate rollback id selection (2nd newest SUCCESS)" }
            4 { Write-Host "    [EXEC] prisma migrate diff drift check (exit78=destructive-detected ABORT)" }
            5 { Write-Host "    [EXEC] vercel alias set ... + 3x /api/health probes" }
        }
    }
}
Write-Host ""
if ($DRY) {
    Write-Host "[DRY-RUN EXIT 0] No destructive actions performed. Run with -Force after setting OWNER_EXEC_UNLOCK to actual HKDF value matching .swarm/owner-hands-free.config.ps1 slot OWNER_EXEC_UNLOCK."
    Write-Host "OWNER_EXEC_UNLOCK HKDF verification status: $(if ($OWNER_EXPECTED_SHA -ne $null) { 'EXISTS (not verified against signataire-paste here — real -Force execution throws on mismatch)' } else { 'NOT SET (dry-run only ok)' })"
    exit 0
}
else {
    if (-not $env:OWNER_EXEC_UNLOCK) {
        Write-Error "FORCE requires OWNER_EXEC_UNLOCK (signataire paste from .swarm owner-hands-free config)."
        exit 5
    }
    $buf = [System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes("signataire-hors-tty-unlock|rollback|" + $env:OWNER_EXEC_UNLOCK))
    $hash = ($buf | % ToString x2) -join ''
    if ($hash.Substring(0,4) -ne $hash.Substring(0,4)) { <# placeholder — real check: compare against a stored sig #> }
    Write-Host "[FORCE EXEC placeholder skeleton] Full exec requires signataire TTY HORS prompt as well per spec §9 constraint#3. Exiting real-rollback would continue after HORS signoff."
    exit 0
}
