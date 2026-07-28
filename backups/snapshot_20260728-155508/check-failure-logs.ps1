$ErrorActionPreference = "Stop"

$pat = "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"
$repo = "younestsouli2019-bot/Nouveau-dossier-3-"
$headers = @{
    Authorization = "Bearer $pat"
    Accept = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
}

# Get logs for latest Owner Hands-Free run
$runId = "27711440794"
$jobs = Invoke-RestMethod -Method Get -Uri "https://api.github.com/repos/$repo/actions/runs/$runId/jobs" -Headers $headers

foreach ($job in $jobs.jobs) {
    if ($job.conclusion -eq "failure") {
        Write-Host "Job: $($job.name) | Job ID: $($job.id)"
        $outFile = "C:\Users\Dell\Downloads\Nouveau dossier (3)\latest-run.zip"
        & curl.exe -k -s -o $outFile "https://api.github.com/repos/$repo/actions/jobs/$($job.id)/logs" -H "Authorization: Bearer $pat" -H "Accept: application/vnd.github+json" 2>&1
        
        $destDir = "C:\Users\Dell\Downloads\Nouveau dossier (3)\latest-run-logs"
        if (Test-Path $destDir) { Remove-Item $destDir -Recurse -Force }
        Expand-Archive -Path $outFile -DestinationPath $destDir -Force
        
        $logFiles = Get-ChildItem $destDir -Recurse -Filter "*.txt"
        foreach ($f in $logFiles) {
            $content = Get-Content $f.FullName -Raw
            $lines = $content -split "`n"
            $errorLines = $lines | Where-Object { $_ -match "\[error\]|fatal|FAIL|Error" }
            if ($errorLines) {
                Write-Host "`n=== ERRORS in $($f.Name) ==="
                $errorLines | ForEach-Object { Write-Host "  $_" }
            }
            # Also show last 20 lines
            if ($f.Name -match "17_Complete|0_run") {
                Write-Host "`n=== LAST 20 lines of $($f.Name) ==="
                $lines | Select-Object -Last 20 | ForEach-Object { Write-Host "  $_" }
            }
        }
    }
}