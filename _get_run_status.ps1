param(
	[Parameter(Mandatory = $true)]
	[string]$RunId
)

$ErrorActionPreference = "Stop"

$root = "C:\Users\Dell\Downloads\Nouveau dossier (3)"
$envFile = Join-Path $root ".env2.txt"
$patLine = (Get-Content $envFile | Where-Object { $_ -match "^GH_PAT=" } | Select-Object -First 1)
if (-not $patLine) { throw "GH_PAT not found in .env2.txt" }
$pat = $patLine.Split("=", 2)[1].Trim()

$repo = "younestsouli2019-bot/Nouveau-dossier-3-"
$headers = @{
	Authorization = ("token " + $pat)
	Accept = "application/vnd.github+json"
	"X-GitHub-Api-Version" = "2022-11-28"
}

$runUrl = ("https://api.github.com/repos/{0}/actions/runs/{1}" -f $repo, $RunId)
try {
	$run = Invoke-RestMethod -Method Get -Uri $runUrl -Headers $headers -TimeoutSec 10
} catch {
	Write-Output ("request_error=" + $_.Exception.Message)
	exit 2
}
$conclusion = if ($null -ne $run.conclusion) { $run.conclusion } else { "" }
Write-Output ("status=" + $run.status + "; conclusion=" + $conclusion)
Write-Output ("run_url=https://github.com/{0}/actions/runs/{1}" -f $repo, $RunId)
