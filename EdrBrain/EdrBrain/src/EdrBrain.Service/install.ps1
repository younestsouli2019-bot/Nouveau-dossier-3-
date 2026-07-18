# EdrBrain Sysmon Installer (ASCII clean)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$ServiceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigXml  = Join-Path $ServiceDir "sysmonconfig-export.xml"
$LogName    = "Microsoft-Windows-Sysmon/Operational"

# 1. Verifier si Sysmon est déjà installé
$sysmonSvc = Get-Service -Name Sysmon64 -ErrorAction SilentlyContinue
if ($sysmonSvc -and $sysmonSvc.Status -eq 'Running') {
    Write-Host "Sysmon already installed and running."
    # Verifier la config actuelle
    $currentConfig = & sysmon.exe -c 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Current config export: OK"
    }
    # Redémarrer avec notre config
    Write-Host "Updating Sysmon config..."
    & sysmon.exe -accepteula -c $ConfigXml
    Restart-Service Sysmon64
    Write-Host "Sysmon config updated."
    exit 0
}

# 2. Télécharger Sysmon si absent
$sysmonExe = Join-Path $env:TEMP "Sysmon64.exe"
if (-not (Test-Path $sysmonExe)) {
    Write-Host "Downloading Sysmon64.exe..."
    Invoke-WebRequest -Uri "https://live.sysinternals.com/Sysmon64.exe" -OutFile $sysmonExe
}

# 3. Installer Sysmon avec notre config
Write-Host "Installing Sysmon with custom config..."
& $sysmonExe -accepteula -i $ConfigXml

# 4. Vérifier que le service tourne et que le log produit des événements
Start-Sleep -Seconds 3
$svc = Get-Service -Name Sysmon64 -ErrorAction SilentlyContinue
if (-not $svc -or $svc.Status -ne 'Running') {
    Write-Error "Sysmon service not running. Check installation."
    exit 1
}

Write-Host "Sysmon service is running."
# Attendre quelques événements
Start-Sleep -Seconds 5
$events = Get-WinEvent -LogName $LogName -MaxEvents 5 -ErrorAction SilentlyContinue
if ($events) {
    Write-Host "Sysmon event log contains events: OK"
} else {
    Write-Warning "No events found in Sysmon log. Check config XML."
}

Write-Host "Sysmon installation and verification complete."
