$token = "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"
$owner = "younestsouli2019-bot"
$repo = "Nouveau-dossier-3-"
$headers = @{
    "Authorization" = "token $token"
    "Accept" = "application/vnd.github.v3+json"
    "X-GitHub-Api-Version" = "2022-11-28"
}

# Get the default branch
$repoInfo = Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$repo" -Headers $headers -Method Get
$defaultBranch = $repoInfo.default_branch
Write-Host "Default branch: $defaultBranch"

# Get the latest commit SHA
$refInfo = Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$repo/git/refs/heads/$defaultBranch" -Headers $headers -Method Get
$latestSha = $refInfo.object.sha
Write-Host "Latest commit SHA: $latestSha"

# Files to commit
$files = @(
    @{ path = "data/procurement-requests.json"; description = "Update procurement: add 3 recipients (Yacine, Top_Adam, Wafae), confirmed items, Younes phone +212639158209, early morning cigarette delivery contacts" },
    @{ path = "ORDER-EXECUTION-PLAN.md"; description = "Update execution plan: 6 recipients, confirmed items, grand total ~61K-75K DH" },
    @{ path = "SWARM-SECURITY-POLICY.md"; description = "Add SWARM security policy: owner-only access, anti-fraud, anti-identity theft, anti-misappropriation" }
)

foreach ($file in $files) {
    $filePath = "C:\Users\Dell\Downloads\Nouveau dossier (3)\Nouveau-dossier-3-\" + $file.path
    $content = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes((Get-Content $filePath -Raw)))
    
    $body = @{
        message = $file.description
        content = $content
        sha = $latestSha
        branch = $defaultBranch
    } | ConvertTo-Json

    try {
        $result = Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$repo/contents/$($file.path)" -Headers $headers -Method Put -Body $body -ContentType "application/json"
        Write-Host "Committed: $($file.path) - SHA: $($result.commit.sha)"
        $latestSha = $result.commit.sha
    } catch {
        Write-Host "Error committing $($file.path): $_"
    }
}

# Also commit the workflow file
$workflowPath = "C:\Users\Dell\Downloads\Nouveau dossier (3)\repo-bot\.github\workflows\owner-handsfree-live.yml"
$workflowContent = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes((Get-Content $workflowPath -Raw)))

$workflowBody = @{
    message = "Enhance SWARM security: owner verification, audit logging, transaction limits, recipient allowlist"
    content = $workflowContent
    sha = $latestSha
    branch = $defaultBranch
} | ConvertTo-Json

try {
    $result = Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$repo/contents/.github/workflows/owner-handsfree-live.yml" -Headers $headers -Method Put -Body $workflowBody -ContentType "application/json"
    Write-Host "Committed workflow: owner-handsfree-live.yml - SHA: $($result.commit.sha)"
} catch {
    Write-Host "Error committing workflow: $_"
}

Write-Host "All commits completed!"
