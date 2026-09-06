@echo off
:: commit-sweep.cmd — one-command commit + rebase + push for the 2026-09-05 working tree.
:: Run from PowerShell:  cmd /c scripts\commit-sweep.cmd
:: Runs NATIVE git.exe (cmd.exe host) — bypasses the broken Git Bash MSYS2 fork.
:: Stages an EXPLICIT file list — never `git add .` (unknown untracked logs/, reports/ stay out).
setlocal
cd /d "%~dp0.."

echo === [1/5] Staging sweep files (explicit list) ===
git add CHANGELOG.md DEPLOYMENTS.md package.json scripts/verify-i8-gates.mjs scripts/commit-sweep.cmd scripts/rail-funding-monitor.mjs scripts/evm-wallet-rail.mjs scripts/ton-wallet-rail.mjs scripts/binance-rail.mjs scripts/rail-health-report.mjs scripts/security-gates.mjs src/finance/capabilities.mjs src/swarm/ConfigurationDriftRemediator.mjs src/security/FinancialSafeMode.mjs data/out/postgres-integrity-audit.json data/out/rail-health-report.json settlements/paypal/owner_ppp2_payout_1788517410867.json
if errorlevel 1 goto :fail

git diff --cached --quiet
if %errorlevel%==0 (
  echo Nothing staged — sweep content already committed. Skipping commit.
  goto :fetch
)

echo === [2/5] Committing ===
git commit -m "chore(sweep): I8 gate verifier + rail-health live-probe rewrite + binance refusal audit-trail + deploy root-cause docs"
if errorlevel 1 goto :fail

:fetch
echo === [3/5] Fetching remote (https-origin) ===
git fetch https-origin
if errorlevel 1 goto :fail

echo === [4/5] Rebasing onto https-origin/main (both histories carry real work — no force-push) ===
git rebase https-origin/main
if errorlevel 1 goto :rebase_conflict

echo === [5/5] Pushing main ===
git push https-origin main
if errorlevel 1 goto :fail

echo.
echo SWEEP COMPLETE. Recent history:
git log --oneline -5
exit /b 0

:rebase_conflict
echo.
echo REBASE CONFLICT — both local and remote advanced. Resolve, then:
echo   git rebase --continue
echo   git push https-origin main
echo (or: git rebase --abort to return to the pre-rebase state)
exit /b 1

:fail
echo.
echo SWEEP FAILED — see output above. Nothing was force-pushed; local commits are intact.
exit /b 1
