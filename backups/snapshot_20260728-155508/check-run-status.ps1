$ErrorActionPreference = "Stop"

$pat = "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"
$repo = "younestsouli2019-bot/Nouveau-dossier-3-"
$headers = @{
    Authorization = "Bearer $pat"
    Accept = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
}

# Check latest runs
$runs = Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$repo/actions/runs?per_page=10" -Headers $headers
Write-Host "=== Latest runs ==="
foreach ($run in $runs.workflow_runs) {
    $status = "$($run.status)"
    $conclusion = "$($run.conclusion)"
    if ($status -eq "completed") {
        $icon = if ($conclusion -eq "success") { "OK" } else { "FAIL" }
    } else {
        $icon = "..."
    }
    Write-Host "  [$icon] $($run.name) | $status | $conclusion | $($run.created_at)"
}

# Get logs for the latest successful/failed runs
Write-Host "`n=== Checking latest 4 triggered runs ==="
$triggeredRuns = $runs.workflow_runs | Where-Object { $_.created_at -gt "2026-06-17T18:38:00Z" }
foreach ($run in $triggeredRuns) {
    Write-Host "`n$($run.name) (ID: $($run.id)) - $($run.status) / $($run.conclusion)"
    if ($run.status -eq "completed" -and $run.conclusion -eq "failure") {
        # Get jobs
        $jobs = Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$repo/actions/runs/$($run.id)/jobs" -Headers $headers
        foreach ($job in $jobs.jobs) {
            Write-Host "  Job: $($job.name) | $($job.conclusion)"
            if ($job.conclusion -eq "failure") {
                # Download logs
                $outFile = "C:\Users\Dell\Downloads\Nouveau dossier (3)\run-$($run.id).zip"
                & curl.exe -k -s -o $outFile "https://api.github.com/repos/$repo/actions/jobs/$($job.id)/logs" -H "Authorization: Bearer $pat" -H "Accept: application/vnd.github+json" 2>&1
                if (Test-Path $outFile) {
                    $size = (Get-Item $outFile).Length
                    if ($size -gt 500) {
                        $destDir = "C:\Users\Dell\Downloads\Nouveau dossier (3)\run-$($run.id)-logs"
                        if (Test-Path $destDir) { Remove-Item $destDir -Recurse -Force }
                        Expand-Archive -Path $outFile -DestinationPath $destDir -Force
                        $logFiles = Get-ChildItem $destDir -Recurse -Filter "*.txt"
                        foreach ($f in $logFiles) {
                            $content = Get-Content $f.FullName -Raw
                            $errors = ($content -split "`n") | Where-Object { $_ -match "\[error\]|fatal" }
                            if ($errors) {
                                Write-Host "  ERRORS in $($f.Name):"
                                $errors | ForEach-Object { Write-Host "    $_" }
                            }
                        }
                    }
                }
            }
        }
    }
}