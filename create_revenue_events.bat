@echo off
cd /d "C:\Users\Dell\Downloads\Nouveau dossier (3)"
python scripts\create_revenue_events.py
if %ERRORLEVEL% neq 0 (
    echo ❌ Error running revenue events script: %ERRORLEVEL%
    exit /b %ERRORLEVEL%
) else (
    echo ✅ Revenue events script completed successfully!
)
