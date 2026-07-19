$ErrorActionPreference = "Stop"

$root = "C:\Users\Dell\Downloads\Nouveau dossier (3)"
$envFile = Join-Path $root ".env2.txt"

function Get-EnvValue([string]$Name) {
	$line = (Get-Content $envFile | Where-Object { $_ -match ("^" + [Regex]::Escape($Name) + "=") } | Select-Object -First 1)
	if (-not $line) { return "" }
	return $line.Split("=", 2)[1].Trim()
}

$env:BASE44_APP_ID = Get-EnvValue "BASE44_APP_ID"
$env:BASE44_SERVICE_TOKEN = Get-EnvValue "BASE44_SERVICE_TOKEN"
$env:BASE44_API_URL = Get-EnvValue "BASE44_API_URL"
$sdk = Get-EnvValue "BASE44_SDK_SERVER_URL"
if ($sdk) { $env:BASE44_SERVER_URL = $sdk }

$swarm = Join-Path $root "swarm-repo"
if (-not (Test-Path $swarm)) { throw "swarm-repo not found" }

Set-Location $swarm
New-Item -ItemType Directory -Force -Path (Join-Path $swarm "exports\\reports") | Out-Null

$out = node .\scripts\base44-preflight.mjs
$outFile = Join-Path $swarm "exports\\reports\\base44_preflight_local.json"
$out | Out-File -FilePath $outFile -Encoding utf8

Write-Output ("local_preflight_report=" + $outFile)
Write-Output ("local_preflight_bytes=" + (Get-Item $outFile).Length)

try {
	$j = $out | ConvertFrom-Json
	$ok = if ($null -ne $j.ok) { $j.ok } else { $null }
	$probeOk = if ($null -ne $j.probe.ok) { $j.probe.ok } else { $null }
	$status = if ($null -ne $j.probe.status) { $j.probe.status } else { "" }
	$reason = if ($null -ne $j.probe.reason) { $j.probe.reason } else { "" }
	Write-Output ("ok=" + ($ok -as [string]) + "; probe_ok=" + ($probeOk -as [string]) + "; status=" + $status + "; reason=" + $reason)
} catch {
	Write-Output "parse_error=true"
}

