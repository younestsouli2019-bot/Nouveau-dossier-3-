$ErrorActionPreference = "Stop"

$root = "C:\Users\Dell\Downloads\Nouveau dossier (3)"
$envFile = Join-Path $root ".env2.txt"
$patLine = (Get-Content $envFile | Where-Object { $_ -match "^GH_PAT=" } | Select-Object -First 1)
if (-not $patLine) { throw "GH_PAT not found in .env2.txt" }
$pat = $patLine.Split("=", 2)[1].Trim()

$repo = "younestsouli2019-bot/Nouveau-dossier-3-"
$wf = "finance-diagnose-runner.yml"
$headers = @{
	Authorization = ("token " + $pat)
	Accept = "application/vnd.github+json"
	"X-GitHub-Api-Version" = "2022-11-28"
}

Write-Output "start"
$runsUrl = ("https://api.github.com/repos/{0}/actions/workflows/{1}/runs?per_page=5" -f $repo, $wf)
try {
	$runs = Invoke-RestMethod -Method Get -Uri $runsUrl -Headers $headers
} catch {
	Write-Output ("request_error=" + $_.Exception.Message)
	exit 2
}
Write-Output ("total_count=" + $runs.total_count)
foreach ($r in ($runs.workflow_runs | Select-Object -First 5)) {
	$conclusion = if ($null -ne $r.conclusion) { $r.conclusion } else { "" }
	Write-Output ("run_id=" + $r.id + "; status=" + $r.status + "; conclusion=" + $conclusion + "; event=" + $r.event)
}
Write-Output "done"
