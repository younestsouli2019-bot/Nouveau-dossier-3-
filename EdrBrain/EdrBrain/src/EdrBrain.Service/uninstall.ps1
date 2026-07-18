<#
.SYNOPSIS
    EdrBrain Uninstallation Script — Removes EdrBrain service and optionally Sysmon.

.DESCRIPTION
    This script:
    1. Stops the EdrBrain service
    2. Removes the EdrBrain Windows service
    3. Optionally removes Sysmon
    4. Optionally removes all EdrBrain data files
    5. Cleans up registry entries

.EXAMPLE
    .\uninstall.ps1              # Remove EdrBrain only (keep data + Sysmon)
    .\uninstall.ps1 -Full        # Remove everything including data and Sysmon
    .\uninstall.ps1 -RemoveSysmon # Remove EdrBrain + Sysmon, keep data
#>

[CmdletBinding()]
param(
    [switch]$Full,
    [switch]$RemoveSysmon
)

$ErrorActionPreference = "Stop"

$InstallDir = "C:\Program Files\EdrBrain"
$DataDir    = "C:\ProgramData\EdrBrain"

function Write-Step($msg) {
    Write-Host ""
    Write-Host "  [*] $msg" -ForegroundColor Cyan
}
function Write-Ok($msg) {
    Write-Host "  [+] $msg" -ForegroundColor Green
}
function Write-Warn($msg) {
    Write-Host "  [!] $msg" -ForegroundColor Yellow
}
function Write-Fail($msg) {
    Write-Host "  [-] $msg" -ForegroundColor Red
}

# ═══════════════════════════════════════════════════════════════
# Admin check
# ═══════════════════════════════════════════════════════════════
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)
if (-not $isAdmin) {
    Write-Fail "Must run as Administrator."
    exit 1
}

Write-Host ""
Write-Host "  ╔═══════════════════════════════════════════════╗" -ForegroundColor Red
Write-Host "  ║     EdrBrain Uninstaller                       ║" -ForegroundColor Red
Write-Host "  ╚═══════════════════════════════════════════════╝" -ForegroundColor Red
Write-Host ""

if ($Full) {
    Write-Warn "FULL UNINSTALL: All data and Sysmon will be removed."
    $confirm = Read-Host "  Are you sure? Type YES to continue"
    if ($confirm -ne "YES") { Write-Host "  Aborted."; exit 0 }
    $RemoveSysmon = $true
}

# ═══════════════════════════════════════════════════════════════
# Step 1: Stop and remove EdrBrain service
# ═══════════════════════════════════════════════════════════════
Write-Step "Stopping EdrBrain service..."

$svc = Get-Service -Name "EdrBrain" -ErrorAction SilentlyContinue
if ($svc) {
    if ($svc.Status -eq "Running") {
        sc.exe stop EdrBrain 2>$null
        Start-Sleep -Seconds 5
    }

    sc.exe delete EdrBrain 2>$null
    Start-Sleep -Seconds 2

    $svcCheck = Get-Service -Name "EdrBrain" -ErrorAction SilentlyContinue
    if (-not $svcCheck) {
        Write-Ok "EdrBrain service removed."
    } else {
        Write-Warn "Service still registered. May require reboot."
    }
} else {
    Write-Warn "EdrBrain service not found (already removed or never installed)."
}

# ═══════════════════════════════════════════════════════════════
# Step 2: Remove Event Log source
# ═══════════════════════════════════════════════════════════════
Write-Step "Removing Event Log source..."

try {
    if ([System.Diagnostics.EventLog]::SourceExists("EdrBrain")) {
        [System.Diagnostics.EventLog]::DeleteEventSource("EdrBrain")
        Write-Ok "Event Log source removed."
    }
} catch {
    Write-Warn "Could not remove Event Log source: $($_.Exception.Message)"
}

# ═══════════════════════════════════════════════════════════════
# Step 3: Remove installation files
# ═══════════════════════════════════════════════════════════════
Write-Step "Removing installation files..."

if (Test-Path $InstallDir) {
    try {
        Remove-Item -Path $InstallDir -Recurse -Force
        Write-Ok "Removed $InstallDir"
    } catch {
        Write-Warn "Could not remove $InstallDir : $($_.Exception.Message)"
        Write-Host "    Files may be locked. Try after reboot." -ForegroundColor Gray
    }
} else {
    Write-Warn "Install directory not found."
}

# ═══════════════════════════════════════════════════════════════
# Step 4: Remove data (only with -Full)
# ═══════════════════════════════════════════════════════════════
if ($Full) {
    Write-Step "Removing data files..."

    if (Test-Path $DataDir) {
        try {
            Remove-Item -Path $DataDir -Recurse -Force
            Write-Ok "Removed $DataDir"
        } catch {
            Write-Warn "Could not remove $DataDir : $($_.Exception.Message)"
        }
    }
} else {
    Write-Step "Preserving data files at $DataDir"
    Write-Host "    Use -Full flag to remove data." -ForegroundColor Gray
}

# ═══════════════════════════════════════════════════════════════
# Step 5: Remove Sysmon (only with -RemoveSysmon or -Full)
# ═══════════════════════════════════════════════════════════════
if ($RemoveSysmon) {
    Write-Step "Uninstalling Sysmon..."

    $sysmonExe = Get-ChildItem -Path "C:\Windows\Sysmon64.exe" -ErrorAction SilentlyContinue
    if (-not $sysmonExe) {
        $sysmonExe = Get-ChildItem -Path "$DataDir\Sysmon\Sysmon64.exe" -ErrorAction SilentlyContinue
    }

    if ($sysmonExe) {
        try {
            & $sysmonExe.FullName -u force 2>$null
            Start-Sleep -Seconds 3
            Write-Ok "Sysmon uninstalled."
        } catch {
            Write-Warn "Could not uninstall Sysmon: $($_.Exception.Message)"
            Write-Host "    Manual removal: sysmon64.exe -u force" -ForegroundColor Gray
        }
    } else {
        Write-Warn "Sysmon binary not found for uninstall."
    }

    # Remove Sysmon data from DataDir
    $sysmonDataDir = Join-Path $DataDir "Sysmon"
    if (Test-Path $sysmonDataDir) {
        Remove-Item -Path $sysmonDataDir -Recurse -Force
        Write-Ok "Removed Sysmon download files."
    }
}

# ═══════════════════════════════════════════════════════════════
# Done
# ═══════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "  ╔═══════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║  EdrBrain Uninstallation Complete                        ║" -ForegroundColor Green
Write-Host "  ╚═══════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
