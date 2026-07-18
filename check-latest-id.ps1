$ErrorActionPreference = "Stop"

$pat = "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"
$repo = "younestsouli2019-bot/Nouveau-dossier-3-"
$headers = @{
    Authorization = "Bearer $pat"
    Accept = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
}

$runs = Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$repo/actions/runs?per_page=5&created=>2026-06-17T18:00:00Z" -Headers $headers
Write-Host "=== Recent runs (with IDs) ==="
foreach ($run in $runs.workflow_runs) {
    $age = [math]::Round(((Get-Date) - [DateTime]::Parse($run.created_at)).TotalMinutes)
    Write-Host "  ID=$($run.id) | run#=$($run.run_number) | $($run.name) | status=$($run.status) | $($run.conclusion) | ${age}m ago"
}

# Find the latest completed owner-handsfree-live with conclusion=failure
$latestOwner = $runs.workflow_runs | Where-Object { $_.name -eq "Owner Hands-Free (Live)" -and $_.conclusion -eq "failure" } | Select-Object -First 1
if ($latestOwner) {
    Write-Host "`n=== Latest failed owner-handsfree-live: ID=$($latestOwner.id) ==="
    $jobs = Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$repo/actions/runs/$($latestOwner.id)/jobs" -Headers $headers
    $failedJob = $jobs.jobs | Where-Object { $_.conclusion -eq "failure" } | Select-Object -First 1
    Write-Host "Job ID: $($failedJob.id)"
    
    # Download logs
    $outFile = "C:\Users\Dell\Downloads\Nouveau dossier (3)\latest-owner-logs.bin"
    & curl.exe -k -L -s -o $outFile -w "HTTP %{http_code}" -H "Authorization: Bearer $pat" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$repo/actions/jobs/$($failedJob.id)/logs"
    Write-Host "Download: HTTP $LASTEXITCODE"
    $size = (Get-Item $outFile).Length
    Write-Host "Size: $size bytes"
    
    if ($size -gt 100) {
        $text = [System.IO.File]::ReadAllText($outFile, [System.Text.Encoding]::UTF8)
        $lines = $text -split "`n"
        $errors = $lines | Where-Object { $_ -match "\[error\]|fatal:" }
        Write-Host "`n=== ERRORS ==="
        $errors | ForEach-Object { Write-Host "  $_" }
    }
}