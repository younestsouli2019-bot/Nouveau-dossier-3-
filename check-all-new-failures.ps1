$ErrorActionPreference = "Stop"

$pat = "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"
$repo = "younestsouli2019-bot/Nouveau-dossier-3-"
$headers = @{
    Authorization = "Bearer $pat"
    Accept = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
}

$runs = Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$repo/actions/runs?per_page=10&created=>2026-06-17T18:00:00Z" -Headers $headers
Write-Host "=== All runs today ==="
foreach ($run in $runs.workflow_runs) {
    $age = [math]::Round(((Get-Date) - [DateTime]::Parse($run.created_at)).TotalMinutes)
    Write-Host "  ID=$($run.id) | run#=$($run.run_number) | $($run.name) | status=$($run.status) | $($run.conclusion) | ${age}m ago"
}

# Check the deploy-site-runner (ID 27712507829) - it just failed
Write-Host "`n=== Deploy Site Runner (27712507829) ==="
$jobs = Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$repo/actions/runs/27712507829/jobs" -Headers $headers
$failedJob = $jobs.jobs | Where-Object { $_.conclusion -eq "failure" } | Select-Object -First 1
Write-Host "Job: $($failedJob.id)"

$outFile = "C:\Users\Dell\Downloads\Nouveau dossier (3)\deploy-runner-logs.bin"
& curl.exe -k -L -s -o $outFile -w "HTTP %{http_code}" -H "Authorization: Bearer $pat" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$repo/actions/jobs/$($failedJob.id)/logs"
Write-Host ""
$text = [System.IO.File]::ReadAllText($outFile, [System.Text.Encoding]::UTF8)
$lines = $text -split "`n"

$lines | Where-Object { $_ -match "\[error\]|fatal:|Mesh=FAIL|PASS|FAIL" } | ForEach-Object { Write-Host "  $_" }

# Check cloud-watchdog (27712509531)
Write-Host "`n=== Cloud Watchdog (27712509531) ==="
$jobs2 = Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$repo/actions/runs/27712509531/jobs" -Headers $headers
$failedJob2 = $jobs2.jobs | Where-Object { $_.conclusion -eq "failure" } | Select-Object -First 1
Write-Host "Job: $($failedJob2.id)"

$outFile2 = "C:\Users\Dell\Downloads\Nouveau dossier (3)\watchdog-logs.bin"
& curl.exe -k -L -s -o $outFile2 -w "HTTP %{http_code}" -H "Authorization: Bearer $pat" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$repo/actions/jobs/$($failedJob2.id)/logs"
Write-Host ""
$text2 = [System.IO.File]::ReadAllText($outFile2, [System.Text.Encoding]::UTF8)
$lines2 = $text2 -split "`n"

$lines2 | Where-Object { $_ -match "\[error\]|fatal:|Mesh=FAIL|PASS|FAIL" } | ForEach-Object { Write-Host "  $_" }