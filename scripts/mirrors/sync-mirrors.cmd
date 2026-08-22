@echo off
REM ==============================================================
REM sync-mirrors.cmd  — push to all configured git mirrors
REM Owner directive: upgrade, mirrors, secure-cloud, doomsday vault
REM Run from repo root:  scripts\mirrors\sync-mirrors.cmd  (or START-SWARM post-cycle)
REM ==============================================================
setlocal
set ROOT=%~dp0..\..
cd /D "%ROOT%"

set LOG_FILE=data\swarm_autonomy\logs\mirrors-sync.log
if not exist data\swarm_autonomy\logs mkdir data\swarm_autonomy\logs

echo [%DATE% %TIME%] ===== mirrors-sync start ===== >> "%LOG_FILE%"

REM 1. GitHub primary (already existing remote: https-origin / origin)
git remote get-url https-origin >nul 2>&1
if %ERRORLEVEL%==0 (
  echo [%DATE% %TIME%] push github https-origin clean-main >> "%LOG_FILE%"
  git push https-origin clean-main >> "%LOG_FILE%" 2>&1
)

REM 2. GitLab mirror — env GITLAB_MIRROR_REPO + GITLAB_PAT (recommended write-only PAT scope: read_repository+write_repository)
if defined GITLAB_MIRROR_REPO (
  git remote get-url gitlab-mirror >nul 2>&1
  if %ERRORLEVEL% neq 0 git remote add gitlab-mirror "%GITLAB_MIRROR_REPO%"
  echo [%DATE% %TIME%] push --mirror gitlab-mirror >> "%LOG_FILE%"
  git push --mirror gitlab-mirror >> "%LOG_FILE%" 2>&1
) else (
  echo [%DATE% %TIME%] SKIP gitlab — GITLAB_MIRROR_REPO not set >> "%LOG_FILE%"
)

REM 3. Codeberg mirror — env CODEBERG_MIRROR_REPO + SSH key in ssh-agent
if defined CODEBERG_MIRROR_REPO (
  git remote get-url codeberg-mirror >nul 2>&1
  if %ERRORLEVEL% neq 0 git remote add codeberg-mirror "%CODEBERG_MIRROR_REPO%"
  echo [%DATE% %TIME%] push --mirror codeberg-mirror >> "%LOG_FILE%"
  git push --mirror codeberg-mirror >> "%LOG_FILE%" 2>&1
) else (
  echo [%DATE% %TIME%] SKIP codeberg — CODEBERG_MIRROR_REPO not set >> "%LOG_FILE%"
)

REM 4. Local file backup mirror — env LOCAL_MIRROR_DIR (e.g. D:\swarm-doomsday-mirror\repo.git)
if defined LOCAL_MIRROR_DIR (
  if exist "%LOCAL_MIRROR_DIR%" (
    git remote get-url local-backup >nul 2>&1
    if %ERRORLEVEL% neq 0 git remote add local-backup "%LOCAL_MIRROR_DIR%"
    echo [%DATE% %TIME%] push --mirror local-backup >> "%LOG_FILE%"
    git push --mirror local-backup >> "%LOG_FILE%" 2>&1
  )
)

echo [%DATE% %TIME%] ===== mirrors-sync done ===== >> "%LOG_FILE%"
endlocal
