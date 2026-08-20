@echo off
REM ============================================================
REM  SWARM GRACEFUL STOP (stops autonomy daemon + improve loop)
REM  Owner runs this if they EVER want a manual pause. Consensus
REM  HOLIDAY pauses are preferred (they keep essentials on).
REM ============================================================
setlocal
set PID_DIR=%~dp0..\data\swarm_autonomy\pids
if not exist "%PID_DIR%" (echo No pid dir found. Nothing to stop. & exit /b 0)
for %%p in (swarm-autonomy.pid swarm-improve-loop.pid) do (
  set "F=%PID_DIR%\%%p"
  if exist "%PID_DIR%\%%p" (
    for /f "usebackq tokens=*" %%a in (`powershell -NoProfile -Command "(Get-Content '%PID_DIR%\%%p' | ConvertFrom-Json | Select-Object -ExpandProperty pid) as [string]"`) do (
      echo [STOP] %%p  PID=%%a
      powershell -NoProfile -Command "$p=%%a; $proc=Get-Process -Id $p -ErrorAction SilentlyContinue; if ($proc) { Stop-Process -Id $p -Force; Write-Host ('  -> killed PID '+$p) } else { Write-Host '  -> not running' } ; Remove-Item -LiteralPath '%PID_DIR%\%%p' -ErrorAction SilentlyContinue"
    )
  ) else (
    echo [SKIP] %%p (no pid file)
  )
)
echo.
echo Swarm stopped.
endlocal
