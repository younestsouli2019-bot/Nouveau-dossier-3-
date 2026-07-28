$token = "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"
$owner = "younestsouli2019-bot"
$repo = "Nouveau-dossier-3-"
$headers = @{
    "Authorization" = "token $token"
    "Accept" = "application/vnd.github.v3+json"
    "X-GitHub-Api-Version" = "2022-11-28"
}

# Get the file SHA directly
$fileInfo = Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$repo/contents/.github/workflows/owner-handsfree-live.yml" -Headers $headers -Method Get
$latestSha = $fileInfo.sha
Write-Host "File SHA: $latestSha"

# Commit the workflow file
$workflowPath = "C:\Users\Dell\Downloads\Nouveau dossier (3)\repo-bot\.github\workflows\owner-handsfree-live.yml"
$workflowContent = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes((Get-Content $workflowPath -Raw)))

$body = @{
    message = "Enhance SWARM security: owner verification, audit logging, transaction limits, recipient allowlist"
    content = $workflowContent
    sha = $latestSha
    branch = "main"
} | ConvertTo-Json

try {
    $result = Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$repo/contents/.github/workflows/owner-handsfree-live.yml" -Headers $headers -Method Put -Body $body -ContentType "application/json"
    Write-Host "Committed workflow: owner-handsfree-live.yml - SHA: $($result.commit.sha)"
} catch {
    Write-Host "Error committing workflow: $_"
}
