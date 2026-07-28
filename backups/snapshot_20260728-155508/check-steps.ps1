$ErrorActionPreference = "Stop"
$pat = "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"
$repo = "younestsouli2019-bot/Nouveau-dossier-3-"
$headers = @{ Authorization = "Bearer $pat"; Accept = "application/vnd.github+json"; "X-GitHub-Api-Version" = "2022-11-28" }

# Check Finance Diagnose
$jobs = Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$repo/actions/runs/27720467549/jobs" -Headers $headers
foreach ($job in $jobs.jobs) {
    Write-Host "Finance Diagnose Job: $($job.name) | status=$($job.status) | conclusion=$($job.conclusion) | started=$($job.started_at)"
}

# Check Owner Hands-Free job steps
$jobs2 = Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$repo/actions/runs/27721143383/jobs" -Headers $headers
foreach ($job in $jobs2.jobs) {
    Write-Host "`nOwner Hands-Free Job: $($job.name) | status=$($job.status) | started=$($job.started_at)"
    if ($job.steps) {
        foreach ($step in $job.steps) {
            Write-Host "  Step: $($step.name) | status=$($step.status) | conclusion=$($step.conclusion)"
        }
    }
}
