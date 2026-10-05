#Requires -RunAsAdministrator
# AUTO-GENERATED v3.5.8 — Doomsday vault builder (AES-256-GCM PBKDF2 1M iterations)
$ErrorActionPreference = "Continue"
Set-Location (Join-Path $PSScriptRoot "..\..")
& powershell -ExecutionPolicy Bypass -NoProfile -File "scripts\mirrors\backup-doomsday-vault.ps1" -Verbose
Write-Host "EXIT=$LASTEXITCODE"