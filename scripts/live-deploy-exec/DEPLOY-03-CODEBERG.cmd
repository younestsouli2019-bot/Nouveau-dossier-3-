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
if "%CODEBERG_MIRROR_REPO%"=="" ( echo ERREUR: set CODEBERG_MIRROR_REPO env + load SSH deploy key ssh-agent first & exit /b 1 )
git remote get-url codeberg-mirror >nul 2>&1
if %ERRORLEVEL% neq 0 git remote add codeberg-mirror "%CODEBERG_MIRROR_REPO%"
git push --mirror codeberg-mirror >> "%LOGFILE%" 2>&1
echo [%DATE% %TIME%] DONE %ERRORLEVEL% >> "%LOGFILE%"
echo. & echo ====== DONE exit=%ERRORLEVEL% ====== & pause
endlocal