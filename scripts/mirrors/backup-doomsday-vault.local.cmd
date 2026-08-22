@echo off
REM ==============================================================
REM backup-doomsday-vault.local.cmd — rebuild the local doomsday vault
REM (was built 2026-05-30. Owner directive 2026-08-20: UPDATE vault
REM to include the 82 days of new audit/quarantine/autonomy artifacts.)
REM
REM Pre-requisites:
REM   * env DOOMSDAY_ARCHIVE_PASSPHRASE  — 30+ chars, matches fingerprint
REM   * 7z or tar + openssl installed (default: tar + openssl aes-256-gcm)
REM   * enough disk: ~3x size of REPORTS + DATA + PRISMA + SRC
REM ==============================================================
setlocal
set ROOT=%~dp0..\..
cd /D "%ROOT%"

if "%DOOMSDAY_ARCHIVE_PASSPHRASE%"=="" (
  echo [vault] ERROR: DOOMSDAY_ARCHIVE_PASSPHRASE env var not set.
  exit /B 1
)

set ISO=%DATE:~0,4%%DATE:~5,2%%DATE:~8,2%T%TIME:~0,2%%TIME:~3,2%%TIME:~6,2%Z
set ISO=%ISO: =0%
set OUTDIR=doomsday-vault\local-run\%ISO%
mkdir "%OUTDIR%" 2>nul

set LOG=data\swarm_autonomy\logs\doomsday-vault-%ISO%.log
mkdir data\swarm_autonomy\logs 2>nul

echo [%DATE% %TIME%] vault build start iso=%ISO% >> "%LOG%"
echo [%DATE% %TIME%] passphrase fingerprint expected: 50f98c6a... >> "%LOG%"

REM --- 1. Tarball ---
set TAR=doomsday-vault\%ISO%.tar
set ENC=%OUTDIR%\doomsday_%ISO%.tgz.enc
tar.exe -czf "%TAR%" ^
  prisma ^
  src\locking src\agents\prompts contracts\escrow reports\policy ^
  reports\FINAL-AUDIT-MASTER-1787178215389.json reports\FINAL-AUDIT-MASTER-SUMMARY-1787178215389.md ^
  reports\audit-report-1787176654540.json reports\audit-summary-1787176654540.md ^
  reports\deep-sqlite-audit-1787177797363.json reports\reconciliation_report.csv ^
  CHANGELOG.md RELEASE_MANIFEST.json ^
  data\quarantine data\owner data\financial ^
  data\swarm_autonomy\state data\swarm_autonomy\logs ^
  scripts\START-SWARM.cmd scripts\STOP-SWARM.cmd scripts\swarm-autonomy-daemon.mjs scripts\swarm-consensus.mjs scripts\swarm-improve-loop.mjs ^
  scripts\final-master-audit.mjs scripts\run-full-integrity-audit.mjs scripts\mirrors ^
  .github\workflows .env.example .gitignore package.json package-lock.json prisma\schema.prisma ^
  >> "%LOG%" 2>&1

REM --- 2. Encrypt with OpenSSL AES-256-GCM using PBKDF2 iterations 1,000,000 ---
openssl.exe enc -aes-256-gcm -salt -pbkdf2 -iter 1000000 ^
  -in "%TAR%" -out "%ENC%" -pass env:DOOMSDAY_ARCHIVE_PASSPHRASE >> "%LOG%" 2>&1

REM --- 3. Compute & store SHA-256 ---
certutil.exe -hashfile "%ENC%" SHA256 > "%OUTDIR%\doomsday_%ISO%.tgz.enc.sha256" 2>>"%LOG%"
for /f "tokens=* skip=1" %%H in ('certutil.exe -hashfile "%ENC%" SHA256 ^| findstr /v "CertUtil"') do set HASH=%%H
set HASH=%HASH: =%

REM --- 4. Compute passphrase fingerprint ---
set FP_FILE=%OUTDIR%\passphrase_fingerprint_sha256.txt
<nul set /p="%DOOMSDAY_ARCHIVE_PASSPHRASE%" > "%TEMP%\_dp_%ISO%.txt"
certutil.exe -hashfile "%TEMP%\_dp_%ISO%.txt" SHA256 > "%FP_FILE%" 2>>"%LOG%"
for /f "tokens=* skip=1" %%H in ('certutil.exe -hashfile "%TEMP%\_dp_%ISO%.txt" SHA256 ^| findstr /v "CertUtil"') do set FP=%%H
set FP=%FP: =%
del /q "%TEMP%\_dp_%ISO%.txt"

REM --- 5. Persist passphrase txt (in vault dir only; .gitignored by default) ---
echo %DOOMSDAY_ARCHIVE_PASSPHRASE% > "%OUTDIR%\DOOMSDAY_ARCHIVE_PASSPHRASE.txt"

REM --- 6. Manifest JSON (matches 2026-05-30 structure so upload workflow parses it) ---
set MANIFEST=%OUTDIR%\manifest.json
echo { > "%MANIFEST%"
echo   "createdAt":"%ISO:~0,4%-%ISO:~4,2%-%ISO:~6,2%T%ISO:~9,2%:%ISO:~11,2%:%ISO:~13,2%Z", >> "%MANIFEST%"
echo   "archive":"doomsday_%ISO%.tgz.enc", >> "%MANIFEST%"
echo   "sha256":"%HASH%", >> "%MANIFEST%"
echo   "encryption":"aes-256-gcm pbkdf2:1000000", >> "%MANIFEST%"
echo   "passphrase_fingerprint_sha256":"%FP%", >> "%MANIFEST%"
echo   "uploads":{ >> "%MANIFEST%"
echo      "presigned":{"attempted":false,"ok":false}, >> "%MANIFEST%"
echo      "supabase":{"attempted":false,"ok":false} >> "%MANIFEST%"
echo   }, >> "%MANIFEST%"
echo   "mirrors":{ >> "%MANIFEST%"
echo      "gitlab":{"attempted":false,"ok":false}, >> "%MANIFEST%"
echo      "codeberg":{"attempted":false,"ok":false} >> "%MANIFEST%"
echo   } >> "%MANIFEST%"
echo } >> "%MANIFEST%"

REM --- 7. Cleanup intermediate tarball ---
del /q "%TAR%" 2>nul

echo [%DATE% %TIME%] vault build DONE hash=%HASH% fp=%FP% out=%OUTDIR% >> "%LOG%"
echo DONE.
endlocal
