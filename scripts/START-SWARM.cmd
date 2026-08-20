@echo off
REM ============================================================
REM  SWARM ONE-CLICK LAUNCHER (Windows CMD, silent, detached)
REM  1) swarm-autonomy-daemon  — watchdog + consensus scheduler + task runner
REM  2) swarm-improve-loop     — parallel high-ROI job worker + WELCOME digest
REM  If already running → resurrect only dead ones (no duplicate starts)
REM ============================================================
setlocal
set ROOT=%~dp0..
set SCRIPTS=%ROOT%\scripts
set SWARM_DATA=%ROOT%\data\swarm_autonomy
set PID_DIR=%SWARM_DATA%\pids
set LOG_DIR=%SWARM_DATA%\logs
if not exist "%SWARM_DATA%" mkdir "%SWARM_DATA%"
if not exist "%PID_DIR%" mkdir "%PID_DIR%"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

REM node execpath
for /f "delims=" %%i in ('where node') do set NODE_EXE=%%i

set LAUNCHED=0

REM ---------- 1) swarm-autonomy-daemon ----------
set PID_FILE=%PID_DIR%\swarm-autonomy.pid
set ALIVE=0
if exist "%PID_FILE%" (
  for /f "usebackq tokens=1,2 delims=:," %%a in (`powershell -NoProfile -Command "(Get-Content '%PID_FILE%' | ConvertFrom-Json | Select-Object -ExpandProperty pid) as [string]"`) do set RUNNING_PID=%%a
  powershell -NoProfile -Command "$p=%RUNNING_PID%; if ((Get-Process -Id $p -ErrorAction SilentlyContinue)) { exit 0 } else { exit 1 }"
  if %ERRORLEVEL%==0 set ALIVE=1
)
if %ALIVE%==0 (
  echo [START] swarm-autonomy-daemon ...
  start "swarm-autonomy" /B /D "%ROOT%" "%NODE_EXE%" "%SCRIPTS%\swarm-autonomy-daemon.mjs" >> "%LOG_DIR%\swarm-autonomy-stdout.log" 2>&1
  set /A LAUNCHED=LAUNCHED+1
) else (
  echo [ALIVE] swarm-autonomy-daemon (pid %RUNNING_PID%)
)

REM ---------- 2) swarm-improve-loop ----------
set PID_FILE=%PID_DIR%\swarm-improve-loop.pid
set ALIVE=0
if exist "%PID_FILE%" (
  for /f "usebackq tokens=1,2 delims=:," %%a in (`powershell -NoProfile -Command "(Get-Content '%PID_FILE%' | ConvertFrom-Json | Select-Object -ExpandProperty pid) as [string]"`) do set RUNNING_PID=%%a
  powershell -NoProfile -Command "$p=%RUNNING_PID%; if ((Get-Process -Id $p -ErrorAction SilentlyContinue)) { exit 0 } else { exit 1 }"
  if %ERRORLEVEL%==0 set ALIVE=1
)
if %ALIVE%==0 (
  echo [START] swarm-improve-loop ...
  start "swarm-improve" /B /D "%ROOT%" "%NODE_EXE%" "%SCRIPTS%\swarm-improve-loop.mjs" >> "%LOG_DIR%\swarm-improve-stdout.log" 2>&1
  set /A LAUNCHED=LAUNCHED+1
) else (
  echo [ALIVE] swarm-improve-loop (pid %RUNNING_PID%)
)

echo.
echo Launch complete. New processes spawned: %LAUNCHED%.
echo   Logs: %LOG_DIR%\*.log
echo   PIDs: %PID_DIR%\*.pid
echo   Heartbeats: data\swarm_autonomy\heartbeats\*.json
echo   Owner digest: data\swarm_autonomy\state\WELCOME_BACK_OWNER.md
endlocal
