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

# 1. List recent workflow runs
Write-Host "=== RECENT WORKFLOW RUNS ==="
$runs = Invoke-RestMethod -Method Get -Uri "$base/actions/runs?per_page=10" -Headers $headers
foreach ($run in $runs.workflow_runs) {
    Write-Host "  $($run.id) | $($run.name) | $($run.status) | $($run.conclusion) | $($run.created_at)"
}

# 2. Get the main branch HEAD tree recursively to find .qodo entries
Write-Host "`n=== REMOTE TREE (.qodo and .gitmodules) ==="
$treeUrl = "$base/git/trees/main?recursive=1"
try {
    $tree = Invoke-RestMethod -Method Get -Uri $treeUrl -Headers $headers
    foreach ($item in $tree.tree) {
        if ($item.path -like ".qodo*" -or $item.path -eq ".gitmodules") {
            Write-Host "  $($item.type) | $($item.mode) | $($item.path) | sha=$($item.sha) | url=$($item.url)"
        }
    }
} catch {
    Write-Host "Error: $($_.Exception.Message)"
    # Try master branch
    try {
        $treeUrl = "$base/git/trees/master?recursive=1"
        $tree = Invoke-RestMethod -Method Get -Uri $treeUrl -Headers $headers
        foreach ($item in $tree.tree) {
            if ($item.path -like ".qodo*" -or $item.path -eq ".gitmodules") {
                Write-Host "  $($item.type) | $($item.mode) | $($item.path) | sha=$($item.sha) | url=$($item.url)"
            }
        }
    } catch {
        Write-Host "Master branch also failed: $($_.Exception.Message)"
    }
}

# 3. Try to get .gitmodules via raw content
Write-Host "`n=== .gitmodules raw (main) ==="
try {
    $rawUrl = "$base/contents/.gitmodules?ref=main"
    $resp = Invoke-RestMethod -Method Get -Uri $rawUrl -Headers $headers
    $content = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($resp.content))
    Write-Host $content
} catch {
    Write-Host "Not found on main: $($_.Exception.Message)"
    try {
        $rawUrl = "$base/contents/.gitmodules?ref=master"
        $resp = Invoke-RestMethod -Method Get -Uri $rawUrl -Headers $headers
        $content = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($resp.content))
        Write-Host $content
    } catch {
        Write-Host "Not found on master either: $($_.Exception.Message)"
    }
}