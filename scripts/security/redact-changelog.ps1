<#
.SYNOPSIS
S3-T06: 6 regex-mask redact CHANGELOG + audit/**/*.md of sensitive bank-destination refs.
Uses EXACT 6 masks per spec. Idempotent. Run standalone before CI commit.
#>
$ErrorActionPreference = "Stop"
$REPO = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$files = @(
    (Join-Path $REPO "CHANGELOG.md"),
    (Join-Path $REPO "docs\financial-reconciliation-2026-09-01.md")
) + (Get-ChildItem -Path (Join-Path $REPO "audit") -Recurse -Include *.md -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)

$Masks = [ordered]@{
    # 1) SALARY RIB182 Attijari Rabat Agdal 018 pattern: 00888 00018 000000000182 80 (spaces optional + RIB 182 labels)
    SALARY_RIB182_MASKED = @(
        '00888[\s_]*00018[\s_]*0{10}182[\s_]*80',
        'RIB[\s:_-]*182'
    );
    # 2) DEBT RIB372 Attijari pattern: 00888 00018 000000000372 41 + RIB 372 labels
    DEBT_RIB372_MASKED = @(
        '00888[\s_]*00018[\s_]*0{10}372[\s_]*41',
        'RIB[\s:_-]*372'
    );
    # 3) SOVEREIGN/OPS BANKING CIRCLE BC646 LU24 4080 + RIB 646 labels
    SOVEREIGN_OPS_BC646_MASKED = @(
        'LU24[\s_]*4080[\s_]*0{4}[\s_]*0412[\s_]*6564[\s_]*6',
        'LU2440800000041265646',
        'RIB[\s:_-]*646'
    );
    # 4) OWNER L2 WALLET EIP55 0xA46225a984E2B2b5E5082E52AE8d8915A09FEFE7 + partial
    OWNER_L2_WALLET_EIP55_MASKED = @(
        '0xA462[0-9a-fA-F]{36}',
        '0xA46225a984E2B2b5E5082E52AE8d8915A09FEFE7'
    );
    # 5) AGENCE 018 RABAT AGDAL reference patterns (Attijari branch)
    AGENCE_018_RABAT_AGDAL_MASKED = @(
        'Ag(ence|dal)?[\w\s]*018[\w\s]*Rabat[\w\s]*Agdal',
        'Agence 018',
        'Rabat Agdal'
    );
    # 6) ATTIJARI CONTENTIEUX REF HUA-2026-RBT-{digits}-018 (case reference)
    ATTIJARI_CONTENTIEUX_REF_MASKED = @(
        'HUA[-_ ]?2026[-_ ]?RBT[-_ ]?\d{6,}[-_ ]?018',
        'Contentieux[\w\s]*#?018'
    )
}

$TotalReplacements = 0
foreach ($f in $files) {
    if (-not (Test-Path -LiteralPath $f)) { continue }
    $content = Get-Content -LiteralPath $f -Raw -Encoding UTF8
    $orig = $content
    foreach ($label in $Masks.Keys) {
        foreach ($regex in $Masks[$label]) {
            $before = $content
            $content = [regex]::Replace($content, $regex, "[$label]", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
            $diff = ([regex]::Matches($before, $regex, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)).Count
            if ($diff -gt 0) {
                Write-Host ("[$f] mask '{0}' -> {1} hits" -f $label, $diff)
                $TotalReplacements += $diff
            }
        }
    }
    if ($content -ne $orig) {
        Set-Content -LiteralPath $f -Value $content -NoNewline -Encoding UTF8
    }
}
Write-Host ""
Write-Host "Total replacements applied: $TotalReplacements"
# Post-verify count (exit 0 when count=0 per spec S3-T06 rule)
$verifyCount = 0
$verifyPatterns = @('00888','0xA462','RIB\s*\d','Agdal.*018','HUA-2026-RBT','LU244080')
foreach ($f in $files) {
    if (-not (Test-Path -LiteralPath $f)) { continue }
    $c = Get-Content -LiteralPath $f -Raw
    foreach ($vp in $verifyPatterns) {
        $m = ([regex]::Matches($c, $vp, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)).Count
        if ($m -gt 0) {
            Write-Warning "[$f] residual '$vp' -> count=$m (REVIEW)"
        }
        $verifyCount += $m
    }
}
Write-Host "Residual sensitive ref occurrences (expect 0): $verifyCount"
exit (if ($verifyCount -eq 0) { 0 } else { 2 })
