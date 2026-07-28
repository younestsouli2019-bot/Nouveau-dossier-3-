$ErrorActionPreference = "Stop"

$pat = "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"
$repo = "younestsouli2019-bot/Nouveau-dossier-3-"
$headers = @{
    Authorization = "Bearer $pat"
    Accept = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
}

# Get logs for the LATEST owner-handsfree-live (run 177, the one that just ran AFTER our fix)
$jobs = Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$repo/actions/runs/177/jobs" -Headers $headers
$failedJob = $jobs.jobs | Where-Object { $_.conclusion -eq "failure" } | Select-Object -First 1
Write-Host "Latest Job ID: $($failedJob.id)"

# Download with new PAT (follow redirects)
$outFile = "C:\Users\Dell\Downloads\Nouveau dossier (3)\latest-fix-attempt.bin"
& curl.exe -k -L -s -o $outFile -w "HTTP %{http_code}" -H "Authorization: Bearer $pat" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$repo/actions/jobs/$($failedJob.id)/logs"
Write-Host ""
$size = (Get-Item $outFile).Length
Write-Host "Size: $size bytes"

if ($size -gt 100) {
    $text = [System.IO.File]::ReadAllText($outFile, [System.Text.Encoding]::UTF8)
    $lines = $text -split "`n"
    
    $errors = $lines | Where-Object { $_ -match "\[error\]|fatal" }
    Write-Host "`n=== ERRORS ==="
    $errors | ForEach-Object { Write-Host "  $_" }
    
    Write-Host "`n=== CHECKOUT STEP 2 LINES ==="
    $keyLines = $lines | Where-Object { $_ -match "submodule|\.qodo|rank|fatal|checkout.*runner" }
    $keyLines | ForEach-Object { Write-Host "  $_" }
}