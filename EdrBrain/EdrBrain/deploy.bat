@echo off
REM ═══════════════════════════════════════════════════════════════
REM  EdrBrain EDR Sensor — Complete Build & Deploy
REM
REM  Prerequisites:
REM    1. Run install.ps1 FIRST to install Sysmon
REM    2. .NET 8 SDK on the BUILD machine
REM    3. Run this script as Administrator
REM
REM  This script:
REM    - Builds the project (self-contained single-file)
REM    - Deploys to C:\Program Files\EdrBrain\
REM    - Installs as a Windows service with auto-restart
REM    - Starts the service
REM ═══════════════════════════════════════════════════════════════

setlocal enabledelayedexpansion

echo.
echo  ╔═══════════════════════════════════════════════════════════╗
echo  ║       EdrBrain EDR Sensor — Build & Deploy               ║
echo  ╚═══════════════════════════════════════════════════════════╝
echo.

REM ── Admin Check ──────────────────────────────────────────────
net session >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo  [!] ERROR: This script must be run as Administrator.
    echo      Right-click CMD → Run as Administrator
    pause
    exit /b 1
)
echo  [+] Running as Administrator

REM ── Variables ────────────────────────────────────────────────
set "INSTALL_DIR=C:\Program Files\EdrBrain"
set "DATA_DIR=C:\ProgramData\EdrBrain"
set "SVC_NAME=EdrBrain"

REM ── Step 1: Verify Sysmon ───────────────────────────────────
echo.
echo  [*] Step 1/8: Verifying Sysmon installation...

sc query Sysmon64 >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo  [!] Sysmon is NOT installed. Run install.ps1 first!
    echo      PowerShell: .\install.ps1
    pause
    exit /b 1
)
echo  [+] Sysmon service found

wevtutil gl Microsoft-Windows-Sysmon/Operational >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo  [!] Sysmon event channel not found. Reinstall Sysmon.
    pause
    exit /b 1
)
echo  [+] Sysmon event channel verified

REM ── Step 2: Build ───────────────────────────────────────────
echo.
echo  [*] Step 2/8: Building EdrBrain (Release, self-contained)...

dotnet publish src\EdrBrain.Service\EdrBrain.Service.csproj ^
    -c Release ^
    -r win-x64 ^
    --self-contained true ^
    -p:PublishSingleFile=true ^
    -p:IncludeNativeLibrariesForSelfExtract=true ^
    -p:EnableCompressionInSingleFile=true ^
    -o publish

if %ERRORLEVEL% neq 0 (
    echo  [!] Build FAILED! Check errors above.
    pause
    exit /b 1
)
echo  [+] Build succeeded

REM ── Step 3: Create Directories ──────────────────────────────
echo.
echo  [*] Step 3/8: Creating installation directories...

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"

echo  [+] Directories ready

REM ── Step 4: Stop Existing Service ───────────────────────────
echo.
echo  [*] Step 4/8: Stopping existing service (if any)...

sc query %SVC_NAME% >nul 2>&1
if %ERRORLEVEL% equ 0 (
    sc stop %SVC_NAME% >nul 2>&1
    timeout /t 5 /nobreak >nul
    sc delete %SVC_NAME% >nul 2>&1
    timeout /t 3 /nobreak >nul
    echo  [+] Previous service removed
) else (
    echo  [+] No previous service found
)

REM ── Step 5: Deploy Files ────────────────────────────────────
echo.
echo  [*] Step 5/8: Deploying files...

REM Copy all published files
xcopy /Y /Q /R publish\* "%INSTALL_DIR%\"

REM Ensure detection rules directory exists
if not exist "%INSTALL_DIR%\Detection\rules" mkdir "%INSTALL_DIR%\Detection\rules"

REM Copy detection rules (in case publish didn't copy them)
xcopy /Y /Q /R src\EdrBrain.Service\Detection\rules\*.json "%INSTALL_DIR%\Detection\rules\"

REM Copy Sysmon config to install directory
if exist src\EdrBrain.Service\sysmonconfig-export.xml (
    xcopy /Y /Q /R src\EdrBrain.Service\sysmonconfig-export.xml "%INSTALL_DIR%\"
)

REM Copy install/uninstall scripts
if exist src\EdrBrain.Service\install.ps1 (
    xcopy /Y /Q /R src\EdrBrain.Service\install.ps1 "%INSTALL_DIR%\"
)
if exist src\EdrBrain.Service\uninstall.ps1 (
    xcopy /Y /Q /R src\EdrBrain.Service\uninstall.ps1 "%INSTALL_DIR%\"
)

echo  [+] Files deployed to %INSTALL_DIR%\

REM ── Step 6: Verify Deployed Files ───────────────────────────
echo.
echo  [*] Step 6/8: Verifying deployment...

set "MISSING=0"

if not exist "%INSTALL_DIR%\EdrBrain.exe" (
    echo  [!] MISSING: EdrBrain.exe
    set "MISSING=1"
)
if not exist "%INSTALL_DIR%\appsettings.json" (
    echo  [!] MISSING: appsettings.json
    set "MISSING=1"
)
if not exist "%INSTALL_DIR%\sysmonconfig-export.xml" (
    echo  [!] MISSING: sysmonconfig-export.xml
    set "MISSING=1"
)
if not exist "%INSTALL_DIR%\Detection\rules\loaders.json" (
    echo  [!] MISSING: Detection\rules\loaders.json
    set "MISSING=1"
)
if not exist "%INSTALL_DIR%\Detection\rules\credential_theft.json" (
    echo  [!] MISSING: Detection\rules\credential_theft.json
    set "MISSING=1"
)
if not exist "%INSTALL_DIR%\Detection\rules\lateral_movement.json" (
    echo  [!] MISSING: Detection\rules\lateral_movement.json
    set "MISSING=1"
)
if not exist "%INSTALL_DIR%\Detection\rules\infostealer.json" (
    echo  [!] MISSING: Detection\rules\infostealer.json
    set "MISSING=1"
)

if "!MISSING!"=="1" (
    echo  [!] Some files are missing! Check deployment.
    pause
    exit /b 1
)

echo  [+] All required files present

REM ── Step 7: Install Windows Service ─────────────────────────
echo.
echo  [*] Step 7/8: Installing Windows service...

sc create %SVC_NAME% ^
    binPath= "%INSTALL_DIR%\EdrBrain.exe" ^
    start= auto ^
    DisplayName= "EdrBrain EDR Sensor" ^
    obj= LocalSystem

if %ERRORLEVEL% neq 0 (
    echo  [!] Service creation FAILED!
    pause
    exit /b 1
)

sc description %SVC_NAME% "EdrBrain Endpoint Detection and Response Sensor — monitors Sysmon events, builds attack graphs, detects threats via Sigma rules, and responds to attacks."

REM Configure recovery: restart on failure, 3 attempts
sc failure %SVC_NAME% reset= 86400 actions= restart/60000/restart/120000/restart/300000
sc failureflag %SVC_NAME% noncritical

echo  [+] Service installed with auto-restart recovery

REM ── Step 8: Start Service ───────────────────────────────────
echo.
echo  [*] Step 8/8: Starting EdrBrain service...

sc start %SVC_NAME%

timeout /t 3 /nobreak >nul

sc query %SVC_NAME% | findstr "RUNNING" >nul
if %ERRORLEVEL% equ 0 (
    echo  [+] Service is RUNNING
) else (
    echo  [!] Service may not have started. Check: sc query %SVC_NAME%
    echo      Also check Event Log for "EdrBrain" source.
)

REM ── Summary ─────────────────────────────────────────────────
echo.
echo  ╔═══════════════════════════════════════════════════════════╗
echo  ║  EdrBrain Deployment Complete!                            ║
echo  ║                                                           ║
echo  ║  Binary:    %INSTALL_DIR%\EdrBrain.exe              ║
echo  ║  Config:    %INSTALL_DIR%\appsettings.json           ║
echo  ║  Rules:     %INSTALL_DIR%\Detection\rules\           ║
echo  ║  Database:  %DATA_DIR%\edr.db                        ║
echo  ║  Sysmon:    sysmonconfig-export.xml                    ║
echo  ║                                                           ║
echo  ║  Commands:                                                ║
echo  ║    Start:   sc start EdrBrain                            ║
echo  ║    Stop:    sc stop EdrBrain                             ║
echo  ║    Status:  sc query EdrBrain                            ║
echo  ║    Remove:  powershell .\uninstall.ps1                  ║
echo  ║                                                           ║
echo  ║  Edit appsettings.json to change:                        ║
echo  ║    - ResponsePolicy (AlertOnly/Suspend/KillProcessTree)  ║
echo  ║    - AlertThreshold (default: 75)                        ║
echo  ║    - Detection rules (add JSON files to rules/)          ║
echo  ╚═══════════════════════════════════════════════════════════╝
echo.

pause
