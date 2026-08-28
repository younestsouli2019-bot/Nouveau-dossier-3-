# ==============================================================
# backup-doomsday-vault.ps1 — robust local doomsday vault builder
# Environment-correct replacement for backup-doomsday-vault.local.cmd
# (fixes locale-broken timestamps + missing tar source paths).
#
# Produces, under doomsday-vault/local-run/<ISO>/:
#   doomsday_<ISO>.tgz.enc        (openssl AES-256-GCM, PBKDF2 1M)
#   doomsday_<ISO>.tgz.enc.sha256
#   passphrase_fingerprint_sha256.txt
#   DOOMSDAY_ARCHIVE_PASSPHRASE.txt  (plaintext, vault-only; vault is gitignored)
#   manifest.json
#
# Usage:  passwords are read from $env:DOOMSDAY_ARCHIVE_PASSPHRASE
#         (or, if unset, from .keys/doomsday-passphrase.txt) and from
#         openssl on PATH (Git usr/bin provides it).
# ==============================================================
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..\..")

# --- Passphrase ---
$passwd = $env:DOOMSDAY_ARCHIVE_PASSPHRASE
if (-not $passwd) {
  $keyFile = Join-Path (Get-Location) ".keys\doomsday-passphrase.txt"
  if (Test-Path $keyFile) { $passwd = (Get-Content $keyFile -Raw).Trim() }
}
if (-not $passwd) { Write-Error "DOOMSDAY_ARCHIVE_PASSPHRASE not set and no .keys/doomsday-passphrase.txt present"; exit 1 }

# --- openssl ---
$openssl = (Get-Command openssl -ErrorAction SilentlyContinue).Source
if (-not $openssl) {
  $cands = @("C:\Program Files\Git\usr\bin\openssl.exe","C:\Program Files\Git\mingw64\bin\openssl.exe")
  $openssl = $cands | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $openssl) { Write-Error "openssl not found"; exit 1 }

# --- ISO timestamp (culture-independent) ---
$iso = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmss") + "Z"
$outDir = Join-Path (Get-Location) "doomsday-vault\local-run\$iso"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

$log = "data\swarm_autonomy\logs\doomsday-vault-$iso.log"
New-Item -ItemType Directory -Path "data\swarm_autonomy\logs" -Force | Out-Null
"[{0}] vault build start iso={1}" -f (Get-Date -Format o), $iso | Add-Content $log

# --- 1. Tarball (only existing paths) ---
$src = @(
  "prisma","src","data\swarm_autonomy","scripts","scripts\mirrors",".github\workflows",
  "CHANGELOG.md","package.json","package-lock.json","prisma\schema.prisma",".gitignore"
) | Where-Object { Test-Path $_ }

$tar = Join-Path (Get-Location) ("doomsday-vault\" + $iso + ".tar")
& tar.exe -czf $tar @src 2>> $log
if ($LASTEXITCODE -ne 0) { Write-Error "tar failed"; exit 1 }

# --- 2. Encrypt (AES-256-GCM, PBKDF2 1,000,000) ---
$enc = Join-Path $outDir ("doomsday_" + $iso + ".tgz.enc")
$env:DP_IN = $passwd
& $openssl enc -aes-256-gcm -salt -pbkdf2 -iter 1000000 -in $tar -out $enc -pass env:DP_IN 2>> $log
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $enc) -or (Get-Item $enc).Length -eq 0) {
  Write-Error "encryption failed"; Remove-Item $tar -ErrorAction SilentlyContinue; exit 1
}
Remove-Item env:DP_IN
Remove-Item $tar -ErrorAction SilentlyContinue

# --- 3. SHA-256 of ciphertext ---
$hashLines = & certutil.exe -hashfile $enc SHA256
$hash = ($hashLines | Where-Object { $_ -match '^[0-9a-fA-F]{64}$' } | Select-Object -First 1).Trim()
"$hash" | Set-Content (Join-Path $outDir ("doomsday_" + $iso + ".tgz.enc.sha256"))

# --- 4. Passphrase fingerprint ---
$fp = (certutil.exe -hashfile (Join-Path (Get-Location) ".keys\doomsday-passphrase.txt") SHA256 |
  ForEach-Object { $_ } | Where-Object { $_ -match '^[0-9a-fA-F]{64}$' } | Select-Object -First 1).Trim()
"$fp" | Set-Content (Join-Path $outDir "passphrase_fingerprint_sha256.txt")

# --- 5. Persist passphrase txt (vault-owned; vault is gitignored) ---
Set-Content (Join-Path $outDir "DOOMSDAY_ARCHIVE_PASSPHRASE.txt") -Value $passwd -NoNewline -Encoding Ascii

# --- 6. Manifest ---
$manifest = @{
  createdAt = $iso
  archive   = "doomsday_$iso.tgz.enc"
  sha256    = $hash
  encryption = "aes-256-gcm pbkdf2:1000000"
  openssl    = $openssl
  passphrase_fingerprint_sha256 = $fp
  uploads     = @{ presigned = @{ attempted=$false; ok=$false }; supabase = @{ attempted=$false; ok=$false } }
  mirrors     = @{ gitlab = @{ attempted=$false; ok=$false }; codeberg = @{ attempted=$false; ok=$false } }
} | ConvertTo-Json -Depth 4
$manifest | Set-Content (Join-Path $outDir "manifest.json")

# --- 7. Verify: decrypt round-trip of magic bytes ---
$verifyOut = Join-Path $outDir "_verify.tgz"
& $env:DP 2> $null
$env:DP_IN = $passwd
& $openssl enc -d -aes-256-gcm -pbkdf2 -iter 1000000 -in $enc -out $verifyOut -pass env:DP_IN 2>> $log
Remove-Item env:DP_IN
$ok = ($LASTEXITCODE -eq 0) -and (Test-Path $verifyOut) -and (Get-Item $verifyOut).Length -gt 0
Remove-Item $verifyOut -ErrorAction SilentlyContinue

"[{0}] vault DONE hash={1} fp={2} out={3} verify={4}" -f (Get-Date -Format o), $hash, $fp, $outDir, $ok | Add-Content $log
Write-Output ("VAULT_OK archive_len={0} sha256={1} verify_roundtrip={2}" -f (Get-Item $enc).Length, $hash.Substring(0,12), $ok)
Write-Output ("OUTDIR=" + $outDir.Replace((Get-Location).Path+'\',''))
exit 0
