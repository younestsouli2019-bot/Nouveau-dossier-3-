@echo off
REM ==============================================================
REM secure-cloud-upload.cmd — upload NEWEST local vault to Supabase secure-cloud bucket
REM (uses backup-mirror.yml workflow's identical 2-step pattern: presigned POST then supabase)
REM
REM Pre-requisites (set as env before calling OR in GitHub Actions secrets):
REM   SUPABASE_URL
REM   SUPABASE_SERVICE_ROLE_KEY
REM   MIRROR_SUPABASE_BUCKET   (e.g. 'swarm-doomsday-vault')
REM   SECURE_CLOUD_PRESIGNED_URL  (optional 2nd path)
REM ==============================================================
setlocal
set ROOT=%~dp0..\..
cd /D "%ROOT%"

set LOG=data\swarm_autonomy\logs\secure-cloud-upload.log
mkdir data\swarm_autonomy\logs 2>nul

echo [%DATE% %TIME%] secure-cloud-upload start >> "%LOG%"

REM --- Pick newest vault subdirectory by ISO name ---
for /f "delims=" %%D in ('dir /B /AD /ON doomsday-vault\local-run 2^>nul') do set LATEST=%%D
if "%LATEST%"=="" ( echo [%DATE% %TIME%] no vault dir found >> "%LOG%" ; exit /B 2 )

set VAULTDIR=doomsday-vault\local-run\%LATEST%
set MANIFEST=%VAULTDIR%\manifest.json
set ENC=%VAULTDIR%\doomsday_%LATEST%.tgz.enc
echo [%DATE% %TIME%] vault=%VAULTDIR% >> "%LOG%"

REM --- STEP 1: Presigned URL direct upload (if configured) ---
if defined SECURE_CLOUD_PRESIGNED_URL (
  echo [%DATE% %TIME%] POST presigned URL >> "%LOG%"
  curl.exe --max-time 600 -X POST -H "Content-Type: application/octet-stream" --data-binary "@%ENC%" "%SECURE_CLOUD_PRESIGNED_URL%" >> "%LOG%" 2>&1
  echo. >> "%LOG%"
) else (
  echo [%DATE% %TIME%] SKIP presigned — SECURE_CLOUD_PRESIGNED_URL not set >> "%LOG%"
)

REM --- STEP 2: Supabase storage object REST API ---
if defined SUPABASE_URL if defined SUPABASE_SERVICE_ROLE_KEY if defined MIRROR_SUPABASE_BUCKET (
  echo [%DATE% %TIME%] PUT Supabase storage >> "%LOG%"
  curl.exe --max-time 600 ^
    -X PUT "%SUPABASE_URL%/storage/v1/object/%MIRROR_SUPABASE_BUCKET%/vaults/%LATEST%/doomsday.tgz.enc" ^
    -H "Authorization: Bearer %SUPABASE_SERVICE_ROLE_KEY%" ^
    -H "Content-Type: application/octet-stream" ^
    --data-binary "@%ENC%" >> "%LOG%" 2>&1
  echo. >> "%LOG%"
  curl.exe --max-time 60 ^
    -X PUT "%SUPABASE_URL%/storage/v1/object/%MIRROR_SUPABASE_BUCKET%/vaults/%LATEST%/manifest.json" ^
    -H "Authorization: Bearer %SUPABASE_SERVICE_ROLE_KEY%" ^
    -H "Content-Type: application/json" ^
    --data-binary "@%MANIFEST%" >> "%LOG%" 2>&1
  echo. >> "%LOG%"
) else (
  echo [%DATE% %TIME%] SKIP Supabase — SUPABASE_URL + SERVICE_ROLE_KEY + BUCKET env incomplete >> "%LOG%"
)

echo [%DATE% %TIME%] secure-cloud-upload done >> "%LOG%"
endlocal
