@echo off
REM ═══════════════════════════════════════════════════════════════
REM  EdrBrain Quick Uninstall — Removes service only (keeps data)
REM  For full removal including data and Sysmon, use:
REM    powershell -ExecutionPolicy Bypass -File uninstall.ps1 -Full
REM ═══════════════════════════════════════════════════════════════

echo.
echo  [*] Stopping EdrBrain service...
sc stop EdrBrain >nul 2>&1
timeout /t 5 /nobreak >nul

echo  [*] Removing EdrBrain service...
sc delete EdrBrain >nul 2>&1

echo  [*] Removing installation files...
rd /s /q "C:\Program Files\EdrBrain" 2>nul

echo.
echo  [+] EdrBrain service removed.
echo      Data preserved at: C:\ProgramData\EdrBrain\
echo      For full removal: powershell -File uninstall.ps1 -Full
echo.
pause
