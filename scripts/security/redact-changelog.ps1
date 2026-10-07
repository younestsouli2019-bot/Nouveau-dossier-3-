# redact-changelog.ps1 — 6 masks exacts
#   SALARY_RIB182        -> SALARY_RIB182_MASKED
#   DEBT_RIB372          -> DEBT_RIB372_MASKED
#   SOVEREIGN_OPS_BC646  -> SOVEREIGN_OPS_BC646_MASKED
#   OWNER_L2_WALLET_EIP55-> OWNER_L2_WALLET_EIP55_MASKED
#   AGENCE_018_RABAT_AGDAL-> AGENCE_018_RABAT_AGDAL_MASKED
#   ATTIJARI_CONTENTIEUX_REF_HUA_  -> …_MASKED
#
# Usage:  pwsh scripts/security/redact-changelog.ps1 -Root . -Force
# Sans -Force: affiche 6 masks + nombre d'occurrences PAR fichier, ne modifie rien.
[CmdletBinding()]
param([string]$Root = '.', [switch]$Force)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Push-Location (Resolve-Path $Root).Path
try {
    $files = Get-ChildItem -Recurse -Include CHANGELOG*.md,changelog*.md,*.txt -File -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch 'node_modules|\.git\\|\.quarantine|\.swarm' }
    $maskList = @(
        @{ pattern = 'SALARY_RIB182';                mask = 'SALARY_RIB182_MASKED' },
        @{ pattern = 'DEBT_RIB372';                  mask = 'DEBT_RIB372_MASKED' },
        @{ pattern = 'SOVEREIGN_RIB646';             mask = 'SOVEREIGN_OPS_BC646_MASKED' },
        @{ pattern = 'OWNER_L2_WALLET_EIP55';        mask = 'OWNER_L2_WALLET_EIP55_MASKED' },
        @{ pattern = 'AGENCE_018_RABAT_AGDAL';       mask = 'AGENCE_018_RABAT_AGDAL_MASKED' },
        @{ pattern = 'ATTIJARI_CONTENTIEUX_REF_HUA_';mask = 'ATTIJARI_CONTENTIEUX_REF_MASKED' },
    )
    $totals = @{}
    foreach ($f in $files) {
        try { $txt = Get-Content $f.FullName -Raw -Encoding UTF8 } catch { continue }
        if ([string]::IsNullOrEmpty($txt)) { continue }
        $local = 0
        foreach ($m in $maskList) {
            $occ = ([regex]::Matches($txt, [regex]::Escape($m.pattern))).Count
            if ($occ -gt 0) {
                $totals[$m.pattern] = ($totals[$m.pattern] ?? 0) + $occ
                $local += $occ
                if ($Force) { $txt = [regex]::Replace($txt, [regex]::Escape($m.pattern), $m.mask) }
            }
        }
        if ($local -gt 0) {
            Write-Host ("{0,-80} occurrences={1}" -f $f.FullName.Replace($(Get-Location).Path+'\',''), $local)
            if ($Force) { Set-Content -Path $f.FullName -Value $txt -Encoding UTF8 -NoNewline }
        }
    }
    Write-Host "--- TOTAUX (tous fichiers) ---"
    foreach ($m in $maskList) { Write-Host ("  · {0,-32} {1}" -f $m.pattern, ($totals[$m.pattern] ?? 0)) }
    if (-not $Force) { Write-Host "`nDRY-RUN: rien modifié. Rerun avec -Force pour appliquer." -ForegroundColor Green }
    exit 0
} finally { Pop-Location }
