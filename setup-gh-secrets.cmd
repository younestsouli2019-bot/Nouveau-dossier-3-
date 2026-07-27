@echo off
REM setup-gh-secrets.cmd — Windows wrapper for setup-gh-secrets.sh
REM Requires Git Bash (or WSL). Falls back to manual gh commands.
setlocal

where bash >nul 2>&1
if errorlevel 1 (
  echo Git Bash is required to run the interactive setup.
  echo Alternatively, set secrets manually with:
  echo     gh secret set KEY --repo younestsouli2019-bot/Nouveau-dossier-3- --body "value"
  echo Or via GitHub UI: Settings ^> Secrets and variables ^> Actions ^> New repository secret
  exit /b 1
)

if "%1"=="--from" (
  bash setup-gh-secrets.sh --from %2
) else if "%1"=="--dry-run" (
  bash setup-gh-secrets.sh --dry-run
) else (
  bash setup-gh-secrets.sh
)
