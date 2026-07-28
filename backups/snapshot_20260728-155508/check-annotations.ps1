$ErrorActionPreference = "Stop"

$pat = "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"
$repo = "younestsouli2019-bot/Nouveau-dossier-3-"
$headers = @{
    Authorization = "Bearer $pat"
    Accept = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
}

# Get annotations for the failed run
$runId = "27711440794"
Write-Host "=== Annotations for run $runId ==="
try {
    $annotations = Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$repo/actions/runs/$runId/jobs" -Headers $headers
    foreach ($job in $annotations.jobs) {
        foreach ($step in $job.steps) {
            if ($step.conclusion -eq "failure") {
                Write-Host "FAILED STEP: $($step.name) (number: $($step.number))"
            }
        }
    }
} catch {
    Write-Host "Error: $($_.Exception.Message)"
}

# Get check runs for the commit to see detailed status
Write-Host "`n=== Check runs for latest commit ==="
$commitSha = "30bb189daba331fe2a302626ea8bf5694f56a024"
try {
    $checkRuns = Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$repo/commits/$commitSha/check-runs" -Headers $headers
    Write-Host "Total check runs: $($checkRuns.total_count)"
    foreach ($cr in $checkRuns.check_runs) {
        Write-Host "  $($cr.name) | $($cr.status) | $($cr.conclusion)"
        if ($cr.output) {
            Write-Host "    Summary: $($cr.output.summary)"
            if ($cr.output.text) {
                Write-Host "    Text: $($cr.output.text.Substring(0, [Math]::Min(500, $cr.output.text.Length)))"
            }
        }
    }
} catch {
    Write-Host "Error: $($_.Exception.Message)"
}

# Also check the Deploy Static Site run which has a build step failure
Write-Host "`n=== Deploy Static Site run (27711437624) ==="
$jobs2 = Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$repo/actions/runs/27711437624/jobs" -Headers $headers
foreach ($job in $jobs2.jobs) {
    Write-Host "Job: $($job.name) | $($job.conclusion)"
    foreach ($step in $job.steps) {
        if ($step.conclusion -eq "failure") {
            Write-Host "  FAILED: $($step.name)"
        }
    }
}