@echo off
echo Starting WET6RUN REVENUE ENGINE...

REM --- Configuration (Set your values here) ---
set SITE_DOMAIN=www.realworldcerts.com
REM set GA_ID=G-XXXXXXXXXX
REM set META_PIXEL_ID=123456789
REM set TIKTOK_PIXEL_ID=ABCDE12345
REM set LEAD_ENDPOINT=https://your-webhook-url/leads
REM set ORDER_ENDPOINT=https://your-webhook-url/orders
REM set RUN_INTERVAL_SEC=3600

echo.
echo [1] Generating Sales Funnels ^& Campaign Packs...
echo [2] Creating Conversion Booster Script (sales_booster.js)...
echo [3] Updating A/B Tests...
echo.

python "%~dp0wet6run_autopilot.py"
pause
