$ErrorActionPreference = "Stop"

# Load Node.js module
$nodePath = "C:\Users\Dell\Downloads\Nouveau dossier (3)\node_modules\.bin\node.exe"
$scriptPath = "C:\Users\Dell\Downloads\Nouveau dossier (3)\scripts\create-missing-revenue-events.mjs"

Write-Host "🔍 Creating missing RevenueEvent records for bank transfer requests..."

& $nodePath $scriptPath

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Successfully created missing RevenueEvent and Earning records!"
} else {
    Write-Host "❌ Error creating RevenueEvent records: $LASTEXITCODE"
    exit 1
}
