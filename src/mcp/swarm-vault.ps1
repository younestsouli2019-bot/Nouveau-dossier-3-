param(
    [Parameter(ParameterSetName="set")]
    [string]$SetSecret,
    [string]$Value,
    [Parameter(ParameterSetName="get")]
    [string]$GetSecret,
    [Parameter(ParameterSetName="list")]
    [switch]$ListSecrets,
    [Parameter(ParameterSetName="remove")]
    [string]$RemoveSecret,
    [switch]$Export,
    [switch]$Import
)

$vaultPrefix = "SwarmDaemon/"
$vaultDir = Join-Path $PSScriptRoot "..\..\.swarm\vault"
$exportFile = Join-Path $PSScriptRoot "..\..\.swarm\vault\secrets.json"

if (-not (Test-Path $vaultDir)) { New-Item -ItemType Directory -Path $vaultDir -Force | Out-Null }

# --- Windows Credential Manager via cmdkey ---
function Set-CredentialManager($target, $value) {
    # Use a temp file to avoid command-line exposure
    $passFile = Join-Path $vaultDir ".tmp_$([System.Guid]::NewGuid()).txt"
    try {
        [System.IO.File]::WriteAllText($passFile, $value, [System.Text.Encoding]::UTF8)
        $result = cmdkey /generic:"$vaultPrefix$target" /user:"swarm-daemon" /pass:`"$(Get-Content $passFile -Raw -Encoding UTF8)`" 2>&1
        if ($LASTEXITCODE -eq 0) { return $true } else { return $false }
    } finally {
        if (Test-Path $passFile) { Remove-Item -Force $passFile }
    }
}

function Get-CredentialManager($target) {
    $result = cmdkey /list:"$vaultPrefix$target" 2>&1
    if ($LASTEXITCODE -ne 0) { return $null }
    # Parse the target line
    if ($result -match "Target: $([regex]::Escape($vaultPrefix + $target))") { return "stored" }
    return $null
}

function Get-CredentialManagerValue($target) {
    $result = cmdkey /list 2>&1
    if ($result -match "$([regex]::Escape($vaultPrefix + $target))\s+\(([^)]+)\)") {
        return $matches[1]  # returns user name (we store value as password)
    }
    return $null
}

# --- DPAPI file fallback ---
function Protect-StringDPAPI($plainText) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($plainText)
    $encrypted = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    $file = Join-Path $vaultDir "$([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($target)).Replace('/', '_')).enc"
    return $encrypted
}

function Unprotect-StringDPAPI($encryptedBytes) {
    $decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect($encryptedBytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    return [System.Text.Encoding]::UTF8.GetString($decrypted)
}

# --- Main ---
try {
    Add-Type -AssemblyName System.Security.Cryptography.ProtectedData -ErrorAction Stop
} catch {
    Write-Host "DPAPI available via System.Security.Cryptography"
}

if ($SetSecret) {
    if (-not $Value) { Write-Host "ERROR: -Value required with -SetSecret"; exit 1 }
    $target = $SetSecret.ToUpper()
    $success = Set-CredentialManager $target $Value
    if ($success) {
        Write-Host "STORED   $target (Credential Manager)"
    } else {
        # Fallback: DPAPI-encrypted file
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
        $encrypted = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
        $file = Join-Path $vaultDir "$target.enc"
        [System.IO.File]::WriteAllBytes($file, $encrypted)
        Write-Host "STORED   $target (DPAPI file: $file)"
    }
    exit 0
}

if ($GetSecret) {
    $target = $GetSecret.ToUpper()
    $file = Join-Path $vaultDir "$target.enc"
    if (Test-Path $file) {
        $encrypted = [System.IO.File]::ReadAllBytes($file)
        $decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
        Write-Host $([System.Text.Encoding]::UTF8.GetString($decrypted))
        exit 0
    }
    Write-Host "NOT_FOUND: $target"
    exit 1
}

if ($RemoveSecret) {
    $target = $RemoveSecret.ToUpper()
    cmdkey /delete:"$vaultPrefix$target" 2>$null
    $file = Join-Path $vaultDir "$target.enc"
    if (Test-Path $file) { Remove-Item -Force $file; Write-Host "REMOVED   $target" }
    exit 0
}

if ($ListSecrets) {
    Write-Host "=== Swarm Vault Secrets ==="
    cmdkey /list 2>&1 | Select-String $vaultPrefix | ForEach-Object {
        if ($_ -match "$vaultPrefix(.+)") {
            Write-Host "  $($matches[1])  (Credential Manager)"
        }
    }
    Get-ChildItem $vaultDir -Filter "*.enc" -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Host "  $($_.BaseName)  (DPAPI file)"
    }
    Write-Host "`nTotal: $((cmdkey /list 2>&1 | Select-String $vaultPrefix | Measure-Object).Count + (Get-ChildItem $vaultDir -Filter '*.enc' -ErrorAction SilentlyContinue | Measure-Object).Count) secret(s)"
    exit 0
}

if ($Export) {
    Write-Host "Exporting vault (DPAPI-bound — same machine only)..."
    $secrets = @{}
    $vaultDir = Join-Path $PSScriptRoot "..\..\.swarm\vault"
    if (-not (Test-Path $vaultDir)) { New-Item -ItemType Directory -Path $vaultDir -Force | Out-Null }
    Get-ChildItem $vaultDir -Filter "*.enc" | ForEach-Object {
        $encrypted = [System.IO.File]::ReadAllBytes($_.FullName)
        $decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
        $secrets[$_.BaseName] = [System.Text.Encoding]::UTF8.GetString($decrypted)
    }
    $secrets | ConvertTo-Json | Set-Content $exportFile -Encoding UTF8
    Write-Host "Exported to $exportFile (WARNING: contains plaintext secrets!)"
    Write-Host "Delete immediately after transfer: Remove-Item '$exportFile' -Force"
    exit 0
}

if ($Import) {
    $vaultDir = Join-Path $PSScriptRoot "..\..\.swarm\vault"
    if (-not (Test-Path $vaultDir)) { New-Item -ItemType Directory -Path $vaultDir -Force | Out-Null }
    if (-not (Test-Path $exportFile)) { Write-Host "No import file at $exportFile"; exit 1 }
    $secrets = Get-Content $exportFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $secrets.PSObject.Properties | ForEach-Object {
        $name = $_.Name
        $value = $_.Value
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($value)
        $encrypted = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
        $file = Join-Path $vaultDir "$name.enc"
        [System.IO.File]::WriteAllBytes($file, $encrypted)
        Write-Host "IMPORTED $name"
    }
    Write-Host "Done. Remove $exportFile for security."
    exit 0
}

Write-Host @"
Swarm Vault — Secure Credential Storage
========================================
USAGE:
  Set:     .\swarm-vault.ps1 -SetSecret NAME -Value "secret123"
  Get:     .\swarm-vault.ps1 -GetSecret NAME
  List:    .\swarm-vault.ps1 -ListSecrets
  Remove:  .\swarm-vault.ps1 -RemoveSecret NAME
  Export:  .\swarm-vault.ps1 -Export   (plaintext JSON — same machine only)
  Import:  .\swarm-vault.ps1 -Import   (from .swarm/vault/secrets.json)

Secrets stored DPAPI-encrypted in .swarm/vault/ — only YOUR Windows user can decrypt.
"@