$ErrorActionPreference = "Stop"

$pat = "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"
$repo = "younestsouli2019-bot/Nouveau-dossier-3-"
$headers = @{
    Authorization = "Bearer $pat"
    Accept = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
}

# Wait 60 seconds for workflows to progress
Write-Host "Waiting 60 seconds..."
Start-Sleep -Seconds 60

$runs = Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$repo/actions/runs?per_page=8&created=>2026-06-17T18:00:00Z" -Headers $headers
Write-Host "`n=== All recent runs ==="
foreach ($run in $runs.workflow_runs) {
    $age = [math]::Round(((Get-Date) - [DateTime]::Parse($run.created_at)).TotalMinutes)
    $dur = if ($run.run_started_at) { [math]::Round(((Get-Date) - [DateTime]::Parse($run.run_started_at)).TotalSeconds) } else { "?" }
    Write-Host "  $($run.run_number) | $($run.name) | status=$($run.status) | conclusion=$($run.conclusion) | ${age}m ago | dur=${dur}s"
}