$ErrorActionPreference = "Stop"

$pat = "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"
$repo = "younestsouli2019-bot/Nouveau-dossier-3-"
$headers = @{
    Authorization = "Bearer $pat"
    Accept = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
}

$runs = Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$repo/actions/runs?per_page=10&created=>2026-06-17T19:05:00Z" -Headers $headers
Write-Host "=== Latest runs ==="
foreach ($run in $runs.workflow_runs) {
    $age = [math]::Round(((Get-Date) - [DateTime]::Parse($run.created_at)).TotalMinutes)
    Write-Host "  ID=$($run.id) | run#=$($run.run_number) | $($run.name) | status=$($run.status) | $($run.conclusion) | ${age}m ago"
}

# Check latest owner-handsfree-live failure
$ownerRun = $runs.workflow_runs | Where-Object { $_.name -eq "Owner Hands-Free (Live)" -and $_.conclusion -eq "failure" } | Select-Object -First 1
if ($ownerRun) {
    Write-Host "`n=== Latest Owner Hands-Free failure (ID=$($ownerRun.id)) ==="
    $jobs = Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$repo/actions/runs/$($ownerRun.id)/jobs" -Headers $headers
    $failedJob = $jobs.jobs | Where-Object { $_.conclusion -eq "failure" } | Select-Object -First 1
    if ($failedJob) {
        $outFile = "C:\Users\Dell\Downloads\Nouveau dossier (3)\owner-latest.bin"
        & curl.exe -k -L -s -o $outFile -w "HTTP %{http_code}" -H "Authorization: Bearer $pat" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$repo/actions/jobs/$($failedJob.id)/logs"
        Write-Host "  Downloaded"
        $text = [System.IO.File]::ReadAllText($outFile, [System.Text.Encoding]::UTF8)
        $lines = $text -split "`n"
        $errors = $lines | Where-Object { $_ -match "\[error\]|fatal:|Missing|FAIL|exit code" }
        $errors | ForEach-Object { Write-Host "    $_" }
        
        # Show validation output
        $valLines = $lines | Where-Object { $_ -match "validate-owner-routing|plaid-preflight|base44-preflight|ok|SWARM_LIVE|PAYPAL|PLAID_SECRET|STRICT" }
        Write-Host "`n  Validation output:"
        $valLines | Select-Object -First 30 | ForEach-Object { Write-Host "    $_" }
    }
}

# Also check owner-handsfree-live success
$ownerSuccess = $runs.workflow_runs | Where-Object { $_.name -eq "Owner Hands-Free (Live)" -and $_.conclusion -eq "success" } | Select-Object -First 1
if ($ownerSuccess) {
    Write-Host "`n=== OWNER HANDS-FREE SUCCEEDED! ID=$($ownerSuccess.id) ==="
}