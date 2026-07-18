$ErrorActionPreference = "Stop"

$envFile = "C:\Users\Dell\Downloads\Nouveau dossier (3)\.env2.txt"
$patLine = Get-Content $envFile | Where-Object { $_ -match "^GH_PAT=" } | Select-Object -First 1
$pat = $patLine.Split("=", 2)[1].Trim()

$repo = "younestsouli2019-bot/Nouveau-dossier-3-"
$base = "https://api.github.com/repos/$repo"
$headers = @{
    Authorization = "Bearer $pat"
    Accept = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
}

# List all workflow files in .github/workflows
Write-Host "=== REMOTE WORKFLOW FILES ==="
try {
    $wfDir = Invoke-RestMethod -Method Get -Uri "$base/contents/.github/workflows" -Headers $headers
    foreach ($item in $wfDir) {
        Write-Host "  $($item.name) | $($item.size) bytes"
    }
} catch {
    Write-Host "Error: $($_.Exception.Message)"
}

# Get the latest Owner Hands-Free run logs
Write-Host "`n=== Getting Owner Hands-Free (Live) logs (27706729632) ==="
try {
    $logUrl = "https://api.github.com/repos/$repo/actions/runs/27706729632/logs"
    $tempFile = "C:\Users\Dell\Downloads\Nouveau dossier (3)\hands-free-logs.zip"
    & curl.exe --ssl-no-revoke -L -o $tempFile -H "Authorization: Bearer $pat" -H "Accept: application/vnd.github+json" $logUrl 2>&1
    if (Test-Path $tempFile) {
        $size = (Get-Item $tempFile).Length
        Write-Host "Downloaded: $size bytes"
        if ($size -gt 100) {
            # Read as text (UTF-8 BOM)
            $text = [System.IO.File]::ReadAllText($tempFile, [System.Text.Encoding]::UTF8)
            # Show last 2000 chars
            $start = [Math]::Max(0, $text.Length - 3000)
            Write-Host $text.Substring($start, [Math]::Min(3000, $text.Length - $start))
        }
    }
} catch {
    Write-Host "Error: $($_.Exception.Message)"
}