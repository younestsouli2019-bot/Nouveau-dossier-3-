@echo off
REM ============================================================
REM  OWNER HANDS-FREE v3.5.8 — 1-Click Launcher (Windows CMD)
REM  Usage: Double-click this file (recommended: Run as ADMINISTRATOR)
REM  Or: scripts\START-OWNER-HANDS-FREE.cmd
REM ============================================================
setlocal enableextensions enabledelayedexpansion
set "SCRIPT_DIR=%~dp0"
for %%i in ("%SCRIPT_DIR%..") do set "ROOT=%%~fi"
set "PS_SCRIPT=%SCRIPT_DIR%start-owner-hands-free.ps1"

REM ------------------------------------------------------------
REM 1. Admin elevation check
REM ------------------------------------------------------------
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
if '%errorlevel%' NEQ '0' (
    echo [HANDS-FREE] Requesting ADMINISTRATOR elevation...
    powershell -NoProfile -Command "Start-Process -FilePath 'powershell.exe' -ArgumentList '-ExecutionPolicy','Bypass','-NoProfile','-NoExit','-File','""%PS_SCRIPT%""','-Verbose' -Verb RunAs"
    exit /b 6
)

REM ------------------------------------------------------------
REM 2. Execute companion PowerShell script
REM ------------------------------------------------------------
echo [HANDS-FREE] Running in Admin PS session. ROOT=%ROOT%
powershell -ExecutionPolicy Bypass -NoProfile -File "%PS_SCRIPT%" -Verbose
set "EXIT_CODE=%ERRORLEVEL%"
echo [HANDS-FREE] Wrapper finished. Exit code = %EXIT_CODE%

REM Brief pause for readability (if run from double-click)
if "%EXIT_CODE%"=="0" (
    echo.
    echo SUCCESS: Payload script completed successfully.
) else (
    echo.
    echo FAILED: Exit code non-zero. Scroll up for FAIL_CLOSED / error messages.
)
timeout /t 6 >nul 2>&1
exit /b %EXIT_CODE%
