@echo off
REM ================================================================
REM AUTO-GENERATED RUNBOOK v3.5.8 — Requires Administrator elevation
REM Double-Click OR right-click → Run as Administrator. NEVER run inside Trae sandbox!
REM ================================================================
setlocal EnableDelayedExpansion
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if %ERRORLEVEL% NEQ 0 ( echo ADMIN ELEV REQUIRED... & powershell -Command "Start-Process '%~f0' -Verb RunAs" & exit /b )
set "ROOT=%~dp0..\.."
cd /D "%ROOT%"
set "LOGFILE=data\swarm_autonomy\logs\%~n0.log"
if not exist "data\swarm_autonomy\logs" mkdir "data\swarm_autonomy\logs"
echo [%DATE% %TIME%] START %~n0 >> "%LOGFILE%"
echo #################################################################
echo   LIVE DEPLOY+EXEC MASTER 1-CLICK v3.5.8
echo   Ordre: 01 GitHub → 02 GitLab → 03 Codeberg → 04 Local → 07 Doomsday → 08 SecureCloud → EXEC ALL 6 RAILS
echo #################################################################
call "%~dp0DEPLOY-01-GITHUB-HORS.cmd"
call "%~dp0DEPLOY-02-GITLAB.cmd"
call "%~dp0DEPLOY-03-CODEBERG.cmd"
call "%~dp0DEPLOY-04-LOCAL-MIRROR.cmd"
powershell -ExecutionPolicy Bypass -File "%~dp0DEPLOY-07-DOOMSDAY-VAULT.ps1"
call "%~dp0DEPLOY-08-SECURE-CLOUD.cmd"
echo ====== FIN DEPLOY — START LIVE EXEC OWNER HANDS-FREE ======
call "scripts\START-OWNER-HANDS-FREE.cmd"
set "FINALCODE=%ERRORLEVEL%"
echo FIN_DEPLOY_EXEC_20261005 FINAL exit=%FINALCODE% >> "%LOGFILE%"
echo [%DATE% %TIME%] DONE %ERRORLEVEL% >> "%LOGFILE%"
echo. & echo ====== DONE exit=%ERRORLEVEL% ====== & pause
endlocal