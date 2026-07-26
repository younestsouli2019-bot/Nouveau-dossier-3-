@echo off
REM ============================================================================
REM FEED-ATTIJARI AUTORUN INSTALLER
REM Adds feed-attijari-watchdog to Windows Task Scheduler so it runs:
REM   - At user logon
REM   - Every 5 minutes (recovers from crash)
REM   - On system boot
REM Run as Administrator the first time.
REM ============================================================================

setlocal

set TASK_NAME=FeedAttijariWatchdog
set REPO_DIR=%~dp0
if "%REPO_DIR:~-1%"=="\" set REPO_DIR=%REPO_DIR:~0,-1%
set PS=powershell
where pwsh >nul 2>&1
if %errorlevel% == 0 set PS=pwsh

echo.
echo Installing watchdog task: %TASK_NAME%
echo Repo: %REPO_DIR%
echo.

REM Register the task (no admin needed if user is admin)
%PS% -NoProfile -Command ^
  "try { ^
     Unregister-ScheduledTask -TaskName '%TASK_NAME%' -Confirm:$false -ErrorAction SilentlyContinue; ^
     $action = New-ScheduledTaskAction -Execute 'node.exe' -Argument '\"%REPO_DIR%\scripts\feed-attijari-watchdog.mjs\"' -WorkingDirectory '%REPO_DIR%'; ^
     $trigger1 = New-ScheduledTaskTrigger -AtLogOn; ^
     $trigger2 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650); ^
     $trigger3 = New-ScheduledTaskTrigger -AtStartup; ^
     $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1); ^
     Register-ScheduledTask -TaskName '%TASK_NAME%' -Action $action -Trigger @($trigger1, $trigger2, $trigger3) -Settings $settings -RunLevel Highest -Description 'Feed-Attijari autonomous watchdog - restarts the pipeline daemon on crash and runs every 5 min.' | Out-Null; ^
     Write-Host '[OK] Task registered.' -ForegroundColor Green; ^
   } catch { ^
     Write-Host '[ERR]' $_.Exception.Message -ForegroundColor Red; ^
     exit 1 ^
   }"

echo.
echo Verifying:
schtasks /Query /TN "%TASK_NAME%" /V /FO LIST 2>nul | findstr /C:"TaskName:" /C:"Status:" /C:"Next Run Time:" | head -5
echo.

REM Run once now
echo Starting one immediate run...
start "feed-attijari-watchdog" /B node "%REPO_DIR%\scripts\feed-attijari-watchdog.mjs"

echo.
echo Done. The watchdog is now scheduled:
echo   - At logon
echo   - Every 5 minutes (recovers from crash)
echo   - At system boot
echo.
echo To check status: schtasks /Query /TN "%TASK_NAME%"
echo To remove:        schtasks /Delete /TN "%TASK_NAME%" /F

endlocal
