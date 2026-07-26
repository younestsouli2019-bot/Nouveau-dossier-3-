@echo off
REM ============================================================================
REM FEED-ATTIJARI WINDOWS DEPLOYER
REM One-shot Windows .cmd wrapper for deploy-feed-attijari.ps1
REM Run from any Windows terminal (cmd.exe, PowerShell, Windows Terminal):
REM   > deploy-attijari.cmd
REM ============================================================================

setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo.
echo ============================================================================
echo   FEED-ATTIJARI WINDOWS DEPLOYER
echo   Repository: %CD%
echo ============================================================================
echo.

REM Detect available PowerShell
where pwsh >nul 2>&1
if %errorlevel% == 0 (
  set "PS=pwsh"
  echo [OK] PowerShell 7+ found ^(pwsh^)
) else (
  where powershell >nul 2>&1
  if %errorlevel% == 0 (
    set "PS=powershell"
    echo [OK] Windows PowerShell found
  ) else (
    echo [ERR] No PowerShell found. Install from https://aka.ms/powershell
    exit /b 1
  )
)

REM Optional: pre-load BC creds from env or prompt
if "%BANKING_CIRCLE_CLIENT_ID%"=="" (
  set /p BANKING_CIRCLE_CLIENT_ID="BANKING_CIRCLE_CLIENT_ID (Enter to skip): "
)
if "%BANKING_CIRCLE_CLIENT_SECRET%"=="" (
  set /p BANKING_CIRCLE_CLIENT_SECRET="BANKING_CIRCLE_CLIENT_SECRET (Enter to skip): "
)
if "%BC_DEBTOR_ACCOUNT%"=="" (
  set /p BC_DEBTOR_ACCOUNT="BC_DEBTOR_ACCOUNT (Enter to skip): "
)
if "%WISE_API_KEY%"=="" (
  set /p WISE_API_KEY="WISE_API_KEY (Enter to skip): "
)
if "%WISE_PROFILE_ID%"=="" (
  set /p WISE_PROFILE_ID="WISE_PROFILE_ID (Enter to skip): "
)

echo.
echo [RUN] %PS% -ExecutionPolicy Bypass -File deploy-feed-attijari.ps1
echo.

%PS% -ExecutionPolicy Bypass -File deploy-feed-attijari.ps1
set RC=%errorlevel%

echo.
if %RC% == 0 (
  echo [DONE] deploy-feed-attijari.ps1 succeeded.
  echo.
  echo To stop the daemon:
  echo   taskkill /F /IM node.exe /FI "WINDOWTITLE eq feed-attijari*"
  echo.
  echo To set creds and run again (daemon will use them within 60s):
  echo   set BANKING_CIRCLE_CLIENT_ID=...
  echo   set BANKING_CIRCLE_CLIENT_SECRET=...
  echo   set BC_DEBTOR_ACCOUNT=...
  echo   deploy-attijari.cmd
) else (
  echo [FAIL] exit %RC%
)

endlocal & exit /b %RC%
