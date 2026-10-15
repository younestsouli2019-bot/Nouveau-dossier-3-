<#
.SYNOPSIS
S3-T01: Catalog ALL tracked sensitive files (git ls-files patterns) + PDFs + PS1 + changelog refs.
Writes pre-scrub-tracked-sensitive-catalog.ndjson for audit trail BEFORE any history-rewrite action.
Never mutates; readonly only.
#>
$ErrorActionPreference = "Stop"
$REPO = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$OUT = Join-Path $REPO "data\out\pre-scrub-tracked-sensitive-catalog.ndjson"
New-Item -ItemType Directory -Force (Split-Path $OUT -Parent) | Out-Null
if (Test-Path $OUT) { Remove-Item $OUT -Force }

$patterns = @(
    "*.pdf","*.ps1","*.env*","*signature*","*sign*","*changelog*","CHANGELOG.md",
    ".github/**/*.ps1","scripts/**/*.ps1","audit/**","docs/**/*reconciliation*",
    "reports/secrets-payouts/**",".swarm/**",".keys/**"
)

function Mask($s) {
    if ([string]::IsNullOrWhiteSpace($s)) { return $s }
    if ($s.Length -le 8) { return "*" * $s.Length }
    return ($s.Substring(0,4) + "…" + $s.Substring($s.Length-2))
}

Write-Host "S3-T01 pre-scrub catalog running over $REPO"
$files = @()
foreach ($p in $patterns) {
    $matched = git -C $REPO ls-files -- $p 2>$null
    if ($matched) { $files += $matched }
}
$unique = $files | Sort-Object -Unique
$i = 0
foreach ($f in $unique) {
    $full = Join-Path $REPO $f
    $exists = Test-Path $full
    $sz = if ($exists) { (Get-Item $full).Length } else { -1 }
    $blob = git -C $REPO rev-parse HEAD:$f 2>$null
    $ext = [IO.Path]::GetExtension($f)
    $sens = "LOW"
    if ($f -match "\.pdf$") { $sens = "HIGH_PDF" }
    elseif ($f -match "\.ps1$") { $sens = "MED_PS1_SCRIPT" }
    elseif ($f -match "CHANGELOG") { $sens = "HIGH_BANK_REF_CHANGELOG" }
    elseif ($f -match "(signature|sign|owner\.signature)") { $sens = "CRITICAL_SIGNATURE_FILE" }
    elseif ($f -match "\.env") { $sens = "CRITICAL_ENV_FILE" }
    elseif ($f -match "(secrets-payouts|owner|vault)") { $sens = "HIGH_REPORT_SECRETS_REF" }
    $first4_last2 = Mask($blob)
    $obj = [ordered]@{
        ts = (Get-Date).ToUniversalTime().ToString("o");
        index = $i;
        file_path = $f;
        exists_in_worktree = $exists;
        size_bytes = $sz;
        git_head_blob_first4_last2 = $first4_last2;
        sensitivity_tier = $sens;
        pattern = $p;
        recommend_scrub_history = ($sens -match "HIGH|CRITICAL")
    }
    $line = $obj | ConvertTo-Json -Compress -Depth 4
    Add-Content -Path $OUT -Value $line -Encoding utf8NoBOM
    $i++
}
Write-Host "Cataloged $i tracked sensitive-candidate files -> $OUT"
Write-Host "Recommend scrub count: $((Get-Content $OUT | ConvertFrom-Json | Where-Object recommend_scrub_history).Count)"
exit 0
