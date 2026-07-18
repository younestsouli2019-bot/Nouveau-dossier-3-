@echo off
cd /d "C:\Users\Dell\Downloads\Nouveau dossier (3)"
node scripts\create-missing-revenue-events.mjs
if %ERRORLEVEL% neq 0 (
    echo ❌ Error creating RevenueEvent records: %ERRORLEVEL%
    exit /b %ERRORLEVEL%
) else (
    echo ✅ Successfully created missing RevenueEvent and Earning records!
)
