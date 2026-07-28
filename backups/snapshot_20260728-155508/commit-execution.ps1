$token = "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"
$owner = "younestsouli2019-bot"
$repo = "Nouveau-dossier-3-"
$headers = @{
    "Authorization" = "token $token"
    "Accept" = "application/vnd.github.v3+json"
    "X-GitHub-Api-Version" = "2022-11-28"
}

# Get the latest SHA
$refInfo = Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$repo/git/refs/heads/main" -Headers $headers -Method Get
$latestSha = $refInfo.object.sha
Write-Host "Latest SHA: $latestSha"

# Files to commit
$files = @(
    @{ path = "EXECUTE-ORDERS.ps1"; msg = "Add order execution script with all contacts and order details" },
    @{ path = "ORDER-TEMPLATES.md"; msg = "Add WhatsApp order templates for all recipients" }
)

foreach ($file in $files) {
    $filePath = "C:\Users\Dell\Downloads\Nouveau dossier (3)\" + $file.path
    $content = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes((Get-Content $filePath -Raw)))
    
    $body = @{
        message = $file.msg
        content = $content
        sha = $latestSha
        branch = "main"
    } | ConvertTo-Json

    try {
        $result = Invoke-RestMethod -Uri "https://api.github.com/repos/$owner/$repo/contents/$($file.path)" -Headers $headers -Method Put -Body $body -ContentType "application/json"
        Write-Host "Committed: $($file.path) - $($result.commit.sha.Substring(0,7))"
        $latestSha = $result.commit.sha
    } catch {
        Write-Host "Error: $($_.Exception.Message)"
    }
}

Write-Host "Done!"
