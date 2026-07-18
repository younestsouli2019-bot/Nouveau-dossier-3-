$filePath = "C:\Users\Dell\Downloads\Nouveau dossier (3)\workflow-logs.zip"
$bytes = [System.IO.File]::ReadAllBytes($filePath)
$hexDump = ($bytes[0..3] | ForEach-Object { '{0:X2}' -f $_ }) -join ' '
Write-Host "First 4 bytes (hex): $hexDump"
Write-Host "Total size: $($bytes.Length) bytes"

# Check if it's a zip (starts with PK = 50 4B)
if ($bytes[0] -eq 0x50 -and $bytes[1] -eq 0x4B) {
    Write-Host "File is a ZIP archive"
} else {
    Write-Host "File is NOT a ZIP archive. Trying to read as text..."
    $text = [System.IO.File]::ReadAllText($filePath)
    Write-Host $text.Substring(0, [Math]::Min(5000, $text.Length))
}
