$ErrorActionPreference = "Stop"

$pat = "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"
$repo = "younestsouli2019-bot/Nouveau-dossier-3-"
$headers = @{
    Authorization = "Bearer $pat"
    Accept = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
}

# Check run 27712515089 (Khwarizmian Swarm CI - just completed 2m ago)
$runId = 27712515089
Write-Host "=== Run $runId (Khwarizmian Swarm CI) ==="
$jobs = Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$repo/actions/runs/$runId/jobs" -Headers $headers
$failedJob = $jobs.jobs | Where-Object { $_.conclusion -eq "failure" } | Select-Object -First 1
Write-Host "Job ID: $($failedJob.id)"

$outFile = "C:\Users\Dell\Downloads\Nouveau dossier (3)\ci-logs.bin"
& curl.exe -k -L -s -o $outFile -w "HTTP %{http_code}" -H "Authorization: Bearer $pat" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$repo/actions/jobs/$($failedJob.id)/logs"
Write-Host ""
$size = (Get-Item $outFile).Length
Write-Host "Size: $size bytes"

if ($size -gt 100) {
    $text = [System.IO.File]::ReadAllText($outFile, [System.Text.Encoding]::UTF8)
    $lines = $text -split "`n"
    $errors = $lines | Where-Object { $_ -match "\[error\]|fatal:" }
    Write-Host "`n=== ERRORS ==="
    $errors | ForEach-Object { Write-Host "  $_" }
    
    # Show checkout lines
    $checkoutLines = $lines | Where-Object { $_ -match "checkout|submodule|\.qodo|rank/real" }
    Write-Host "`n=== CHECKOUT LINES ==="
    $checkoutLines | Select-Object -First 10 | ForEach-Object { Write-Host "  $_" }
}

# Also check run 27712514913 (Deploy Static Site)
$runId2 = 27712514913
Write-Host "`n=== Run $runId2 (Deploy Static Site) ==="
$jobs2 = Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$repo/actions/runs/$runId2/jobs" -Headers $headers
$failedJob2 = $jobs2.jobs | Where-Object { $_.conclusion -eq "failure" } | Select-Object -First 1
Write-Host "Job ID: $($failedJob2.id)"

$outFile2 = "C:\Users\Dell\Downloads\Nouveau dossier (3)\deploy-logs.bin"
& curl.exe -k -L -s -o $outFile2 -w "HTTP %{http_code}" -H "Authorization: Bearer $pat" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$repo/actions/jobs/$($failedJob2.id)/logs"
Write-Host ""
$size2 = (Get-Item $outFile2).Length
Write-Host "Size: $size2 bytes"

if ($size2 -gt 100) {
    $text2 = [System.IO.File]::ReadAllText($outFile2, [System.Text.Encoding]::UTF8)
    $lines2 = $text2 -split "`n"
    $errors2 = $lines2 | Where-Object { $_ -match "\[error\]|fatal:" }
    Write-Host "`n=== ERRORS ==="
    $errors2 | ForEach-Object { Write-Host "  $_" }
}