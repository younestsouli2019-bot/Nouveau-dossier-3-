$ErrorActionPreference = "Stop"

$envFile = "C:\Users\Dell\Downloads\Nouveau dossier (3)\.env2.txt"
$patLine = Get-Content $envFile | Where-Object { $_ -match "^GH_PAT=" } | Select-Object -First 1
$pat = $patLine.Split("=", 2)[1].Trim()

$repo = "younestsouli2019-bot/Nouveau-dossier-3-"

$headers = @{
    Authorization = "token $pat"
    Accept = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
}

# Get .gitmodules from the repo
$url = "https://api.github.com/repos/$repo/contents/.gitmodules"
try {
    $resp = Invoke-RestMethod -Method Get -Uri $url -Headers $headers
    $content = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($resp.content))
    Write-Host "=== .gitmodules content ==="
    Write-Host $content
} catch {
    Write-Host "Error getting .gitmodules: $($_.Exception.Message)"
    # Try the API with different approach
    $resp2 = curl.exe -s -H "Authorization: token $pat" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$repo/contents/.gitmodules"
    Write-Host "Raw response: $resp2"
}

# Also check if .qodo directory exists in the repo
Write-Host "`n=== Checking .qodo directory ==="
$qodoUrl = "https://api.github.com/repos/$repo/contents/.qodo"
try {
    $qodoResp = Invoke-RestMethod -Method Get -Uri $qodoUrl -Headers $headers
    foreach ($item in $qodoResp) {
        Write-Host "$($item.type): $($item.name)"
    }
} catch {
    Write-Host ".qodo directory not found or error: $($_.Exception.Message)"
}