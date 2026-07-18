$ErrorActionPreference = "Stop"
$pat = "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"
$repo = "younestsouli2019-bot/Nouveau-dossier-3-"
$headers = @{ Authorization = "Bearer $pat"; Accept = "application/vnd.github+json"; "X-GitHub-Api-Version" = "2022-11-28" }

# Check run 27721143383 (the current running one)
$jobs = Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$repo/actions/runs/27721143383/jobs" -Headers $headers
foreach ($job in $jobs.jobs) {
    Write-Host "Job: $($job.name) | status=$($job.status) | conclusion=$($job.conclusion) | started=$($job.started_at)"
    
    # Try to get logs even if in progress
    if ($job.status -eq "in_progress" -or $job.conclusion) {
        $outFile = "C:\Users\Dell\Downloads\Nouveau dossier (3)\owner-current.bin"
        $code = & curl.exe -k -L -s -o $outFile -w "%{http_code}" -H "Authorization: Bearer $pat" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$repo/actions/jobs/$($job.id)/logs"
        Write-Host "  Log download: HTTP $code"
        if (Test-Path $outFile) {
            $size = (Get-Item $outFile).Length
            Write-Host "  Log size: $size bytes"
            if ($size -gt 100) {
                $text = [System.IO.File]::ReadAllText($outFile, [System.Text.Encoding]::UTF8)
                $lines = $text -split "`n"
                Write-Host "  Total lines: $($lines.Count)"
                # Show last 20 lines
                Write-Host "`n  Last 20 lines:"
                $start = [Math]::Max(0, $lines.Count - 20)
                $lines[$start..($lines.Count - 1)] | ForEach-Object { Write-Host "    $_" }
            }
        }
    }
}

# Also check if there's a newer run
$runs = Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$repo/actions/runs?per_page=3&created=>2026-06-17T19:40:00Z" -Headers $headers
Write-Host "`n=== Latest runs ==="
foreach ($run in $runs.workflow_runs) {
    $age = [math]::Round(((Get-Date) - [DateTime]::Parse($run.created_at)).TotalMinutes)
    Write-Host "  $($run.name) | status=$($run.status) | $($run.conclusion) | ${age}m ago | ID=$($run.id)"
}
