$ErrorActionPreference = "Stop"

$pat = "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"
$repo = "younestsouli2019-bot/Nouveau-dossier-3-"
$base = "https://api.github.com/repos/$repo"
$headers = @{
    Authorization = "Bearer $pat"
    Accept = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
}

# Check runner-main branch for .qodo
Write-Host "=== runner-main branch ==="
$runnerRef = Invoke-RestMethod -Method Get -Uri "$base/git/ref/heads/runner-main" -Headers $headers
$runnerCommit = Invoke-RestMethod -Method Get -Uri "$base/git/commits/$($runnerRef.object.sha)" -Headers $headers
Write-Host "SHA: $($runnerRef.object.sha)"
Write-Host "Message: $($runnerCommit.message)"

$runnerTree = Invoke-RestMethod -Method Get -Uri "$base/git/trees/$($runnerCommit.tree.sha)" -Headers $headers
foreach ($item in $runnerTree.tree) {
    if ($item.path -eq ".qodo" -or $item.path -eq ".gitmodules") {
        Write-Host "FOUND: $($item.path) | mode=$($item.mode) | sha=$($item.sha)"
        if ($item.mode -eq "160000") {
            Write-Host "  ** GITLINK - BROKEN SUBMODULE **"
        }
    }
}

# Check all branches for .qodo
Write-Host "`n=== Checking all branches for .qodo ==="
$branches = Invoke-RestMethod -Method Get -Uri "$base/branches" -Headers $headers
foreach ($b in $branches) {
    try {
        $bCommit = Invoke-RestMethod -Method Get -Uri "$base/git/commits/$($b.commit.sha)" -Headers $headers
        $bTree = Invoke-RestMethod -Method Get -Uri "$base/git/trees/$($bCommit.tree.sha)" -Headers $headers
        $hasQodo = $false
        foreach ($item in $bTree.tree) {
            if ($item.path -eq ".qodo") {
                $hasQodo = $true
                Write-Host "  $($b.name): HAS .qodo (mode=$($item.mode))"
            }
        }
        if (-not $hasQodo) {
            Write-Host "  $($b.name): clean (no .qodo)"
        }
    } catch {
        Write-Host "  $($b.name): error checking"
    }
}

# Check the owner-handsfree-live.yml workflow
Write-Host "`n=== owner-handsfree-live.yml ==="
try {
    $wfContent = Invoke-RestMethod -Method Get -Uri "$base/contents/.github/workflows/owner-handsfree-live.yml" -Headers $headers
    $yaml = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($wfContent.content))
    # Show relevant checkout lines
    $lines = $yaml -split "`n"
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match "checkout|repository|ref:|path:" -and $lines[$i] -notmatch "^#") {
            Write-Host "  L$($i+1): $($lines[$i].Trim())"
        }
    }
} catch {
    Write-Host "Error: $($_.Exception.Message)"
}