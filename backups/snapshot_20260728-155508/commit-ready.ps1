$token = "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"
$owner = "younestsouli2019-bot"
$repo = "Nouveau-dossier-3-"
$headers = @{
    "Authorization" = "token $token"
    "Accept" = "application/vnd.github.v3+json"
    "X-GitHub-Api-Version" = "2022-11-28"
}

$refInfo = Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$repo/git/refs/heads/main" -Headers $headers -Method Get
$latestSha = $refInfo.object.sha

$filePath = "C:\Users\Dell\Downloads\Nouveau dossier (3)\READY-TO-SEND.md"
$content = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes((Get-Content $filePath -Raw)))

$body = @{
    message = "Add complete READY-TO-SEND order execution package with all contacts, links, and templates"
    content = $content
    sha = $latestSha
    branch = "main"
} | ConvertTo-Json

try {
    $result = Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$repo/contents/READY-TO-SEND.md" -Headers $headers -Method Put -Body $body -ContentType "application/json"
    Write-Host "Committed: READY-TO-SEND.md - $($result.commit.sha.Substring(0,7))"
} catch {
    Write-Host "Error: $($_.Exception.Message)"
}
