@echo off
setlocal

set "ACTION=%~1"
if "%ACTION%"=="" set "ACTION=readiness"

if not exist "%~dp0CREDS.txt" (
  echo Missing CREDS.txt next to deploy-live.bat
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-live.ps1" -Action "%ACTION%"

endlocal
