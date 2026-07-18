$ErrorActionPreference = "Stop"

$envFile = "C:\Users\Dell\Downloads\Nouveau dossier (3)\.env2.txt"
$patLine = Get-Content $envFile | Where-Object { $_ -match "^GH_PAT=" } | Select-Object -First 1
$pat = $patLine.Split("=", 2)[1].Trim()

$repo = "younestsouli2019-bot/Nouveau-dossier-3-"
$base = "https://api.github.com/repos/$repo"
$headers = @{
    Authorization = "Bearer $pat"
    Accept = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
}

# 1. Check .qodo root tree (non-recursive)
Write-Host "=== .qodo directory tree ==="
try {
    $qodoTree = Invoke-RestMethod -Method Get -Uri "$base/git/trees/main:.qodo" -Headers $headers
    foreach ($item in $qodoTree.tree) {
        Write-Host "  $($item.type) | mode=$($item.mode) | $($item.path) | sha=$($item.sha)"
    }
} catch {
    Write-Host "Error: $($_.Exception.Message)"
}

# 2. Check root tree
Write-Host "`n=== Root tree ==="
try {
    $rootTree = Invoke-RestMethod -Method Get -Uri "$base/git/trees/main" -Headers $headers
    foreach ($item in $rootTree.tree) {
        if ($item.path -eq ".qodo" -or $item.path -eq ".gitmodules") {
            Write-Host "  $($item.type) | mode=$($item.mode) | $($item.path) | sha=$($item.sha)"
        }
    }
} catch {
    Write-Host "Error: $($_.Exception.Message)"
}

# 3. Get latest run (Owner Hands-Free) logs
Write-Host "`n=== Getting latest run logs (27706729632) ==="
$jobsUrl = "$base/actions/runs/27706729632/jobs"
$jobs = Invoke-RestMethod -Method Get -Uri $jobsUrl -Headers $headers
foreach ($job in $jobs.jobs) {
    Write-Host "Job: $($job.id) | $($job.name) | $($job.conclusion)"
    if ($job.conclusion -eq "failure") {
        $logFile = "C:\Users\Dell\Downloads\Nouveau dossier (3)\latest-run-logs.txt"
        try {
            Invoke-WebRequest -Uri "$base/actions/jobs/$($job.id)/logs" -Headers $headers -OutFile $logFile -UseBasicParsing
            $size = (Get-Item $logFile).Length
            Write-Host "  Downloaded $size bytes"
        } catch {
            Write-Host "  Download failed: $($_.Exception.Message)"
        }
    }
}