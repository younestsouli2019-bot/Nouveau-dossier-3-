$ErrorActionPreference = "Stop"
$pat = "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"
$repo = "younestsouli2019-bot/Nouveau-dossier-3-"
$headers = @{ Authorization = "Bearer $pat"; Accept = "application/vnd.github+json"; "X-GitHub-Api-Version" = "2022-11-28" }

# Cancel the stuck runs
Write-Host "=== Cancelling stuck Owner Hands-Free (27721143383) ==="
try {
    Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$repo/actions/runs/27721143383/cancel" -Headers $headers
    Write-Host "  Cancelled"
} catch {
    Write-Host "  Error: $($_.Exception.Message)"
}

Write-Host "`n=== Cancelling stuck Finance Diagnose (27720467549) ==="
try {
    Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$repo/actions/runs/27720467549/cancel" -Headers $headers
    Write-Host "  Cancelled"
} catch {
    Write-Host "  Error: $($_.Exception.Message)"
}
