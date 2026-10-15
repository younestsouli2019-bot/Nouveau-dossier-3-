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
if "%SUPABASE_URL%"=="" echo WARN SUPABASE_URL empty & goto :skip
if "%SUPABASE_SERVICE_ROLE_KEY%"=="" echo WARN SUPABASE_SERVICE_ROLE_KEY empty & goto :skip
if "%MIRROR_SUPABASE_BUCKET%"=="" echo WARN MIRROR_SUPABASE_BUCKET empty & goto :skip
call "scripts\mirrors\secure-cloud-upload.cmd"
:skip
echo [%DATE% %TIME%] DONE %ERRORLEVEL% >> "%LOGFILE%"
echo. & echo ====== DONE exit=%ERRORLEVEL% ====== & pause
endlocal