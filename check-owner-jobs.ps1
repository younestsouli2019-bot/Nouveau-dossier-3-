$ErrorActionPreference = "Stop"
$pat = "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"
$repo = "younestsouli2019-bot/Nouveau-dossier-3-"
$headers = @{ Authorization = "Bearer $pat"; Accept = "application/vnd.github+json"; "X-GitHub-Api-Version" = "2022-11-28" }

$runs = Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$repo/actions/runs?per_page=5&created=>2026-06-17T19:25:00Z" -Headers $headers
foreach ($run in $runs.workflow_runs) {
    $age = [math]::Round(((Get-Date) - [DateTime]::Parse($run.created_at)).TotalMinutes)
    Write-Host "  $($run.name) | status=$($run.status) | conclusion=$($run.conclusion) | ${age}m ago | ID=$($run.id)"
}

# Check Owner Hands-Free run 179 specifically
$ownerRun = $runs.workflow_runs | Where-Object { $_.name -eq "Owner Hands-Free (Live)" } | Select-Object -First 1
if ($ownerRun) {
    $jobs = Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$repo/actions/runs/$($ownerRun.id)/jobs" -Headers $headers
    foreach ($job in $jobs.jobs) {
        Write-Host "`n  Job: $($job.name) | status=$($job.status) | conclusion=$($job.conclusion)"
        if ($job.conclusion -eq "failure") {
            $outFile = "C:\Users\Dell\Downloads\Nouveau dossier (3)\owner-verify2.bin"
            & curl.exe -k -L -s -o $outFile -w "HTTP %{http_code}" -H "Authorization: Bearer $pat" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$repo/actions/jobs/$($job.id)/logs"
            $text = [System.IO.File]::ReadAllText($outFile, [System.Text.Encoding]::UTF8)
            $lines = $text -split "`n"
            Write-Host "  Lines: $($lines.Count)"
            $lines | Where-Object { $_ -match "\[error\]|fatal:|Missing|exit code|PASS|FAIL" } | ForEach-Object { Write-Host "    $_" }
            Write-Host "`n  Last 10 lines:"
            $lines[($lines.Count - 10)..($lines.Count - 1)] | ForEach-Object { Write-Host "    $_" }
        }
        if ($job.conclusion -eq "success") {
            Write-Host "  *** JOB SUCCEEDED ***"
        }
    }
}
