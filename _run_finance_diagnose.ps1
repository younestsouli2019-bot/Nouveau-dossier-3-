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

$dispatchUrl = ("https://api.github.com/repos/{0}/actions/workflows/{1}/dispatches" -f $repo, $wf)
$body = @{ ref = "main" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri $dispatchUrl -Headers $headers -Body $body | Out-Null

$start = (Get-Date).ToUniversalTime()
Write-Output ("dispatched_at_utc=" + $start.ToString("o"))

Start-Sleep -Seconds 3
$runId = $null
for ($i = 0; $i -lt 60; $i++) {
	$runsUrl = ("https://api.github.com/repos/{0}/actions/workflows/{1}/runs?per_page=5" -f $repo, $wf)
	$runs = Invoke-RestMethod -Method Get -Uri $runsUrl -Headers $headers
	$cand = $runs.workflow_runs |
		Where-Object { $_.event -eq "workflow_dispatch" -and ([DateTime]$_.created_at).ToUniversalTime() -ge $start.AddMinutes(-1) } |
		Sort-Object created_at -Descending |
		Select-Object -First 1
	if ($cand) { $runId = $cand.id; break }
	Start-Sleep -Seconds 3
}

if (-not $runId) { throw "Could not find dispatched run id" }
Write-Output ("run_id=" + $runId)
Write-Output ("run_url=https://github.com/{0}/actions/runs/{1}" -f $repo, $runId)

$run = $null
for ($i = 0; $i -lt 120; $i++) {
	$runUrl = ("https://api.github.com/repos/{0}/actions/runs/{1}" -f $repo, $runId)
	$run = Invoke-RestMethod -Method Get -Uri $runUrl -Headers $headers
	$conclusion = if ($null -ne $run.conclusion) { $run.conclusion } else { "" }
	Write-Output ("status=" + $run.status + "; conclusion=" + $conclusion)
	if ($run.status -eq "completed") { break }
	Start-Sleep -Seconds 5
}

if ($null -eq $run -or $run.status -ne "completed") { throw "Run did not complete in time" }

$artsUrl = ("https://api.github.com/repos/{0}/actions/runs/{1}/artifacts" -f $repo, $runId)
$arts = Invoke-RestMethod -Method Get -Uri $artsUrl -Headers $headers
$art = $arts.artifacts | Where-Object { $_.name -like "finance-diagnose-*" } | Sort-Object created_at -Descending | Select-Object -First 1
if (-not $art) { throw "No finance-diagnose artifact found" }

$zipDir = Join-Path $root "_artifacts"
New-Item -ItemType Directory -Force -Path $zipDir | Out-Null
$zipPath = Join-Path $zipDir ("finance-diagnose-" + $runId + ".zip")
$extractDir = Join-Path $zipDir ("finance-diagnose-" + $runId)
if (Test-Path $extractDir) { Remove-Item -Recurse -Force $extractDir }

$dlUrl = $art.archive_download_url
& curl.exe --ssl-no-revoke -L -H ("Authorization: token " + $pat) -H "Accept: application/vnd.github+json" $dlUrl -o $zipPath | Out-Null
Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

$preflight = Get-ChildItem -Path $extractDir -Recurse -Filter "base44_preflight_last.json" | Select-Object -First 1
if (-not $preflight) { throw "base44_preflight_last.json not found in artifact" }

$len = (Get-Item $preflight.FullName).Length
Write-Output ("preflight_path=" + $preflight.FullName)
Write-Output ("preflight_bytes=" + $len)
if ($len -le 2) { throw "base44_preflight_last.json is empty/too small" }

$txt = Get-Content $preflight.FullName -Raw
$j = $null
try { $j = $txt | ConvertFrom-Json } catch { $j = $null }

if ($j) {
	$ok = if ($null -ne $j.ok) { $j.ok } elseif ($null -ne $j.OK) { $j.OK } else { $null }
	$err = if ($null -ne $j.error) { $j.error } elseif ($null -ne $j.errors) { $j.errors } else { $null }
	Write-Output ("preflight_ok=" + ($ok -as [string]))
	if ($err) { Write-Output ("preflight_error=" + ($err | ConvertTo-Json -Compress)) }
} else {
	Write-Output "preflight_json_parse=failed"
}

