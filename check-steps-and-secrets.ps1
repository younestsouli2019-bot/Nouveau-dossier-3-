$ErrorActionPreference = "Stop"

$pat = "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"
$repo = "younestsouli2019-bot/Nouveau-dossier-3-"
$headers = @{
    Authorization = "Bearer $pat"
    Accept = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
}

# Check latest run - did the checkout step pass? (i.e., is .qodo/rank fixed?)
$runId = "27711440794"
Write-Host "=== Owner Hands-Free run $runId ==="
$jobs = Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$repo/actions/runs/$runId/jobs" -Headers $headers
foreach ($job in $jobs.jobs) {
    Write-Host "Job: $($job.name) | Status: $($job.status) | Conclusion: $($job.conclusion)"
    Write-Host "  Started: $($job.started_at)"
    Write-Host "  Completed: $($job.completed_at)"
    foreach ($step in $job.steps) {
        $icon = if ($step.conclusion -eq "success") { "OK" } elseif ($step.conclusion -eq "failure") { "!!" } else { ".." }
        Write-Host "  [$icon] $($step.name) | $($step.conclusion)"
    }
}

# Store new PAT as repo secret
Write-Host "`n=== Storing GH_PAT as repo secret ==="
$secretName = "GH_PAT"
$secretValue = "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"

# Get public key for secrets encryption
$keyResp = Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$repo/actions/secrets/public-key" -Headers $headers
Write-Host "Public key ID: $($keyResp.key_id)"

# Note: Can't encrypt secrets via API without sodium/libsodium
# Check if secret already exists
try {
    $existing = Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$repo/actions/secrets/$secretName" -Headers $headers
    Write-Host "Secret $secretName already exists (updated_at: $($existing.updated_at))"
} catch {
    Write-Host "Secret $secretName not found or error: $($_.Exception.Message)"
}

# Also store the Base44 credentials
Write-Host "`n=== Checking Base44 secrets ==="
foreach ($name in @("BASE44_APP_ID", "BASE44_SERVICE_TOKEN", "BASE44_API_URL")) {
    try {
        $existing = Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$repo/actions/secrets/$name" -Headers $headers
        Write-Host "  $name exists (updated: $($existing.updated_at))"
    } catch {
        Write-Host "  $name not found"
    }
}