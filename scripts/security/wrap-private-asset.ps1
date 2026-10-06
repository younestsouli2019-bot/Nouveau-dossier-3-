<#
.SYNOPSIS
S3-T05: Wrap out-of-tree private assets with AES-256-GCM.
Format per spec: <12b nonce><16b authTag><ciphertext>.
HKDF salt = sha256("PRIVATE_ASSETS_FILE_ENCRYPTION_V1") derived from OWNER_EXEC_UNLOCK.
Dry-run default checks path; -Wrap/-Unwrap flags require OWNER_EXEC_UNLOCK env set (signataire paste only).

Example: wrap HUISSIER PDF to USERPROFILE\rwc-private-assets\legal\
  wrap-private-asset.ps1 -Source audit/legal/HUISSIER_MANDAT_INFO_SECURE.pdf -Dest $env:USERPROFILE\rwc-private-assets\legal\file.pdf.aesgcm -Wrap
#>
[CmdletBinding()]
param(
    [string]$Source,
    [string]$Dest,
    [switch]$Wrap,
    [switch]$Unwrap
)
$ErrorActionPreference = "Stop"
$HKDF_SALT = [System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes("PRIVATE_ASSETS_FILE_ENCRYPTION_V1"))

function Hkdf([byte[]]$ikm, [byte[]]$salt, [string]$info, [int]$len=32) {
    $prf = New-Object System.Security.Cryptography.HMACSHA256 -ArgumentList (,$salt)
    $prk = $prf.ComputeHash($ikm)
    $result = [byte[]]::CreateInstance([byte], 0)
    $t = [byte[]]::CreateInstance([byte], 0)
    $counter = 1
    while ($result.Length -lt $len) {
        $list = New-Object 'System.Collections.Generic.List[byte]'
        $list.AddRange($t)
        $list.AddRange([System.Text.Encoding]::UTF8.GetBytes($info))
        $list.Add([byte]$counter)
        $hmac2 = New-Object System.Security.Cryptography.HMACSHA256 -ArgumentList (,$prk)
        $t = $hmac2.ComputeHash($list.ToArray())
        $newArr = [byte[]]::CreateInstance([byte], ($result.Length + $t.Length))
        [Buffer]::BlockCopy($result,0,$newArr,0,$result.Length)
        [Buffer]::BlockCopy($t,0,$newArr,$result.Length,$t.Length)
        $result = $newArr
        $counter++
    }
    $out = [byte[]]::CreateInstance([byte], $len)
    [Buffer]::BlockCopy($result,0,$out,0,$len)
    return $out
}

function Mask($s){ if($s.Length -le 8){ return "*"*$s.Length } return $s.Substring(0,4)+"…"+$s.Substring($s.Length-2) }

if (-not $Source -or -not $Dest) {
    Write-Host "Dry-run syntax: wrap-private-asset.ps1 -Source <path> -Dest <path.aesgcm> [-Wrap | -Unwrap]"
    Write-Host "  OWNER_EXEC_UNLOCK env must be set for real wrap/unwrap. Round-trip test by signataire: first run with -Wrap 42-random-bytes dummy test-roundtrip-123.pdf.aesgcm then -Unwrap compare. Then delete dummy."
    Write-Host "  Example dry-run file layout (NO ACTION this run):"
    Write-Host "    SRC  -> $env:USERPROFILE\repo\audit\legal\HUISSIER_MANDAT_INFO_SECURE.pdf (move after wrap out of repo entirely)"
    Write-Host "    DEST -> $env:USERPROFILE\rwc-private-assets\legal\HUISSIER_MANDAT_INFO_SECURE.pdf.aesgcm (HKDF AES-256-GCM format 12+16+CT)"
    $s = if ($env:OWNER_EXEC_UNLOCK) { Mask $env:OWNER_EXEC_UNLOCK } else { "<NOT SET, dry-run ok>" }
    Write-Host "  OWNER_EXEC_UNLOCK = $s"
    exit 0
}

if ((-not $Wrap) -and (-not $Unwrap)) {
    Write-Host "[DRY-RUN] No action. Add -Wrap or -Unwrap + OWNER_EXEC_UNLOCK. Source=$Source Dest=$Dest"
    exit 0
}

if (-not $env:OWNER_EXEC_UNLOCK) {
    Write-Error "OWNER_EXEC_UNLOCK env not set (signataire paste only). Abort."
    exit 5
}

$key = Hkdf -ikm ([System.Text.Encoding]::UTF8.GetBytes($env:OWNER_EXEC_UNLOCK)) -salt $HKDF_SALT -info "aes-gcm-wrap-v1:realworldcerts" -len 32
Write-Host ("key[first4..last2]={0} (HMAC-verified only)" -f (Mask ([BitConverter]::ToString($key).Replace("-","").ToLower())))

$srcPath = (Resolve-Path $Source -ErrorAction Stop).Path
$destDir = Split-Path $Dest -Parent
New-Item -ItemType Directory -Force $destDir | Out-Null

if ($Wrap) {
    $plain = [IO.File]::ReadAllBytes($srcPath)
    $aes = New-Object System.Security.Cryptography.AesGcm -ArgumentList $key,16
    $nonce = [byte[]]::CreateInstance([byte], 12)
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($nonce)
    $ct = [byte[]]::CreateInstance([byte], $plain.Length)
    $tag = [byte[]]::CreateInstance([byte], 16)
    $aes.Encrypt($nonce, $plain, $ct, $tag)
    $fs = [IO.File]::Open($Dest, [IO.FileMode]::Create, [IO.FileAccess]::Write)
    try {
        $fs.Write($nonce,0,12)
        $fs.Write($tag,0,16)
        $fs.Write($ct,0,$ct.Length)
    } finally { $fs.Dispose() }
    Write-Host "WRAP OK: $Dest ($($plain.Length) -> $((Get-Item $Dest).Length) bytes)"
}
elseif ($Unwrap) {
    $blob = [IO.File]::ReadAllBytes($srcPath)
    if ($blob.Length -lt 28) { Write-Error "Wrapped blob too short (<12+16)"; exit 6 }
    $nonce = $blob[0..11]
    $tag   = $blob[12..27]
    $ct    = $blob[28..($blob.Length-1)]
    $aes = New-Object System.Security.Cryptography.AesGcm -ArgumentList $key,16
    $plain = [byte[]]::CreateInstance([byte], $ct.Length)
    try {
        $aes.Decrypt($nonce, $ct, $tag, $plain)
    } catch {
        Write-Error "AES-GCM auth tag FAIL — wrong key or corrupt file. NOT retrying."
        exit 8
    }
    [IO.File]::WriteAllBytes($Dest, $plain)
    Write-Host "UNWRAP OK: $Dest ($($plain.Length) bytes)"
}
exit 0
