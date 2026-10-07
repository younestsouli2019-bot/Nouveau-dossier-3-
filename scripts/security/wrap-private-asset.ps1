# wrap-private-asset.ps1
# Déplace un fichier PDF/secret vers $env:USERPROFILE\rwc-private-assets\legal\
# en AES-256-GCM + HKDF(OWNER_EXEC_UNLOCK, salt="PRIVATE_ASSETS_FILE_ENCRYPTION_V1", info="AES256GCM/RWCLegal/v1")
# Format sortie: <12 nonce> + <16 tag> + <ciphertext> (concat, pas de header JSON).
# DRY-RUN PAR DÉFAUT; -Force requiert HKDF OWNER_EXEC_UNLOCK.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$Path,
    [switch]$Force = $false
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if (-not (Test-Path $Path)) { Write-Error "Fichier introuvable: $Path"; exit 2 }
$plain = [System.IO.File]::ReadAllBytes((Resolve-Path $Path).Path)
if ($plain.Length -eq 0) { Write-Error 'Fichier vide'; exit 4 }

$unlock = if ($env:OWNER_EXEC_UNLOCK) { $env:OWNER_EXEC_UNLOCK } else { '' }
if ($Force -and $unlock.Length -lt 43) {
    Write-Host 'OWNER_EXEC_UNLOCK < 43 chars OU vide. -Force nécessite un unlock ≥43 chars. DRY-RUN seulement.' -ForegroundColor Yellow
    $Force = $false
}
$ROOT = (Get-Location).Path
$TGT_DIR = Join-Path $env:USERPROFILE 'rwc-private-assets\legal'
New-Item -ItemType Directory -Path $TGT_DIR -Force | Out-Null
$name = Split-Path -Leaf $Path
$out = Join-Path $TGT_DIR ($name + '.aesgcm')

Write-Host ('wrap-private-asset: src_len={0} tgt_dir={1} force={2}' -f $plain.Length, $TGT_DIR, $Force)
if (-not $Force) {
    Write-Host ('Dry-run: générerait un wrap AES-256-GCM vers {0} (pas de mutation). Re-run avec -Force + OWNER_EXEC_UNLOCK 43+ en session standalone pour appliquer.' -f $out)
    exit 0
}
$saltText = 'PRIVATE_ASSETS_FILE_ENCRYPTION_V1'
$infoText = 'AES256GCM/RWCLegal/v1'
$salt = [System.Text.Encoding]::UTF8.GetBytes($saltText)
$info = [System.Text.Encoding]::UTF8.GetBytes($infoText)
$ikm = [System.Text.Encoding]::UTF8.GetBytes($unlock)
# Simple derive: HMACSHA256 x 2 (HKDF expand sans dépendance).
$prf = [System.Security.Cryptography.HMACSHA256]::new($salt)
$t1 = $prf.ComputeHash($ikm + $info + [byte]0x01)
$t2 = $prf.ComputeHash($t1  + $info + [byte]0x02)
$key = New-Object byte[] 32
[Array]::Copy($t1, 0, $key, 0, 16); [Array]::Copy($t2, 0, $key, 16, 16)
$aes = [System.Security.Cryptography.AesGcm]::new($key)
$nonce = New-Object byte[] 12; [System.Security.Cryptography.RandomNumberGenerator]::Fill($nonce)
$tag = New-Object byte[] 16
$cipher = New-Object byte[] $plain.Length
$aes.Encrypt($nonce, $plain, $cipher, $tag, $null)
$final = New-Object byte[] ($nonce.Length + $tag.Length + $cipher.Length)
[Array]::Copy($nonce, 0, $final, 0, $nonce.Length)
[Array]::Copy($tag, 0, $final, $nonce.Length, $tag.Length)
[Array]::Copy($cipher, 0, $final, $nonce.Length + $tag.Length, $cipher.Length)
[System.IO.File]::WriteAllBytes($out, $final)
Write-Host ("Wrote {0} bytes → {1}" -f $final.Length, $out)
exit 0
