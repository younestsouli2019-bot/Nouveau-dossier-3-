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

$jobsUrl = ("https://api.github.com/repos/{0}/actions/runs/{1}/jobs?per_page=20" -f $repo, $RunId)
try {
	$jobs = Invoke-RestMethod -Method Get -Uri $jobsUrl -Headers $headers -TimeoutSec 10
} catch {
	Write-Output ("request_error=" + $_.Exception.Message)
	exit 2
}

foreach ($j in ($jobs.jobs | Select-Object -First 10)) {
	$st = if ($null -ne $j.started_at) { $j.started_at } else { "" }
	$en = if ($null -ne $j.completed_at) { $j.completed_at } else { "" }
	$conclusion = if ($null -ne $j.conclusion) { $j.conclusion } else { "" }
	Write-Output ("job_id=" + $j.id + "; job=" + $j.name + "; status=" + $j.status + "; conclusion=" + $conclusion + "; started_at=" + $st + "; completed_at=" + $en)
}
