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

# Check collaborators
Write-Host "=== Repo collaborators ==="
try {
    $collabs = Invoke-RestMethod -Method Get -Uri "$base/collaborators" -Headers $headers
    foreach ($c in $collabs) {
        Write-Host "  $($c.login) | $($c.role_name) | permissions: write=$($c.permissions.admin) push=$($c.permissions.push)"
    }
} catch {
    Write-Host "Error: $($_.Exception.Message)"
}

# Check repo permissions for current user
Write-Host "`n=== Repo permissions for current user ==="
try {
    $repoInfo = Invoke-RestMethod -Method Get -Uri $base -Headers $headers
    Write-Host "Owner: $($repoInfo.owner.login)"
    Write-Host "Permissions: $($repoInfo.permissions | ConvertTo-Json -Compress)"
} catch {
    Write-Host "Error: $($_.Exception.Message)"
}

# Check if the PAT can create issues (different permission)
Write-Host "`n=== Testing issue creation permission ==="
try {
    $issueBody = @{
        title = "test: workflow fix verification"
        body = "This is a test to verify write permissions."
    } | ConvertTo-Json
    $issue = Invoke-RestMethod -Method Post -Uri "$base/issues" -Headers $headers -Body $issueBody -ContentType "application/json; charset=utf-8"
    Write-Host "SUCCESS: Can create issues! Issue #$($issue.number)"
    # Close the test issue immediately
    Invoke-RestMethod -Method Patch -Uri "$base/issues/$($issue.number)" -Headers $headers -Body '{"state":"closed"}' -ContentType "application/json; charset=utf-8" | Out-Null
    Write-Host "Closed test issue"
} catch {
    Write-Host "Issue creation failed: $($_.Exception.Message)"
}