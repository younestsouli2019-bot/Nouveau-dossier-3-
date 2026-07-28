$ErrorActionPreference = "Stop"

$pat = "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"
$repo = "younestsouli2019-bot/Nouveau-dossier-3-"
$headers = @{
    Authorization = "Bearer $pat"
    Accept = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
}

$runs = Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$repo/actions/runs?per_page=10&created=>2026-06-17T18:50:00Z" -Headers $headers
Write-Host "=== All recent runs ==="
foreach ($run in $runs.workflow_runs) {
    $age = [math]::Round(((Get-Date) - [DateTime]::Parse($run.created_at)).TotalMinutes)
    Write-Host "  ID=$($run.id) | run#=$($run.run_number) | $($run.name) | status=$($run.status) | $($run.conclusion) | ${age}m ago"
}

# Check any completed failures for error details
$failed = $runs.workflow_runs | Where-Object { $_.conclusion -eq "failure" -and $_.created_at -gt "2026-06-17T18:55:00Z" }
foreach ($run in $failed) {
    Write-Host "`n=== $($run.name) (ID=$($run.id)) ==="
    $jobs = Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$repo/actions/runs/$($run.id)/jobs" -Headers $headers
    $failedJob = $jobs.jobs | Where-Object { $_.conclusion -eq "failure" } | Select-Object -First 1
    if ($failedJob) {
        $outFile = "C:\Users\Dell\Downloads\Nouveau dossier (3)\temp-logs.bin"
        & curl.exe -k -L -s -o $outFile -w "HTTP %{http_code}" -H "Authorization: Bearer $pat" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$repo/actions/jobs/$($failedJob.id)/logs"
        Write-Host "  Job: $($failedJob.name) | Downloaded"
        $text = [System.IO.File]::ReadAllText($outFile, [System.Text.Encoding]::UTF8)
        $lines = $text -split "`n"
        $errors = $lines | Where-Object { $_ -match "\[error\]|fatal:|SyntaxError|Mesh=FAIL|FAIL" }
        $errors | ForEach-Object { Write-Host "    $_" }
    }
}