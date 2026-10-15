<#
.SYNOPSIS
S3-T03: Build credential rotation receipts NDJSON (signataire fills rotated values).
13+ labels per spec. Never stores real secret — only first4…last2 masked via signataire paste.
#>
$ErrorActionPreference = "Stop"
$REPO = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$OUT = Join-Path $REPO "data\out\credential-rotation-receipts.ndjson"
New-Item -ItemType Directory -Force (Split-Path $OUT -Parent) | Out-Null
if (Test-Path $OUT) { Remove-Item $OUT -Force }

$LABELS = @(
    "DATABASE_URL_NEON_POOLED_MAIN_SSLMODE_REQUIRE_SLOT2",
    "PAYPAL_CLIENT_ID",
    "PAYPAL_CLIENT_SECRET",
    "PAYPAL_WEBHOOK_ID",
    "PAYPAL_PARTNER_ATTRIBUTION_ID",
    "WISE_API_TOKEN",
    "BANKINGCIRCLE_USER",
    "BANKINGCIRCLE_PASS",
    "BANKINGCIRCLE_CERT",
    "BINANCE_API_KEY",
    "BINANCE_API_SECRET",
    "USDC_ARB_OWNER_WALLET_PRIVATE_KEY_SLOT5",
    "USDC_ARB_RPC_PROVIDER_API_KEY_SLOT6",
    "OWNER_EXEC_UNLOCK_HKDF_MASTER",
    "POSTGRES_ROLE_SALES_WRITER_PASS",
    "POSTGRES_ROLE_PAYOUT_WRITER_PASS",
    "POSTGRES_ROLE_MARKETING_AGENT_PASS"
)
$i = 0
foreach ($label in $LABELS) {
    $obj = [ordered]@{
        ts = (Get-Date).ToUniversalTime().ToString("o");
        index = $i++;
        credential_label = $label;
        rotated = $false;
        rotated_at = $null;
        old_value_first4_last2 = "<SIGNATAIRE-PASTE: old first4…last2 before rotation>";
        new_value_first4_last2 = "<SIGNATAIRE-PASTE: new first4…last2 after rotation>";
        rotation_method = "<SIGNATAIRE-PASTE: provider console name + timestamp + ticket/UI ref 40+ chars minimum per spec rule>";
        verified_in_provider_webui = $false;
        post_rotate_probe_passed = $false;
        notes = "<SIGNATAIRE-PASTE: 40+ chars audit note — 'Rotated via provider X UI YYYY-MM-DD at HH:MM UTC, confirmed no old-key valid 401s in logs for 15min window' example>"
    }
    Add-Content -Path $OUT -Value ($obj | ConvertTo-Json -Compress -Depth 5) -Encoding utf8NoBOM
}
Write-Host "Rotation receipt template written -> $OUT ($i labels). Signataire fills each old/new masked value + 40char notes then sets rotated=true; CI verifies $true + 40char-min in S9 gate."
exit 0
