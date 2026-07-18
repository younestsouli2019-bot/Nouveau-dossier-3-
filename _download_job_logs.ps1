param(
	[Parameter(Mandatory = $true)]
	[string]$JobId
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

$zipDir = Join-Path $root "_job_logs"
New-Item -ItemType Directory -Force -Path $zipDir | Out-Null
$zipPath = Join-Path $zipDir ("job-" + $JobId + ".zip")
$extractDir = Join-Path $zipDir ("job-" + $JobId)
if (Test-Path $extractDir) { Remove-Item -Recurse -Force $extractDir }

$dlUrl = ("https://api.github.com/repos/{0}/actions/jobs/{1}/logs" -f $repo, $JobId)
& curl.exe --ssl-no-revoke -L -H ("Authorization: token " + $pat) -H "Accept: application/vnd.github+json" $dlUrl -o $zipPath | Out-Null
Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

$log = Get-ChildItem -Path $extractDir -Recurse -Filter "*.txt" | Sort-Object Length -Descending | Select-Object -First 1
if (-not $log) { throw "No log file extracted" }

Write-Output ("log_path=" + $log.FullName)
Write-Output ("log_bytes=" + (Get-Item $log.FullName).Length)
Select-String -Path $log.FullName -Pattern "overrides_src=|base44_preflight|No events ready|Found" -SimpleMatch | Select-Object -First 80 | ForEach-Object { $_.Line }

