param(
    [switch]$Uninstall,
    [switch]$Status
)

$taskName = "SwarmAutonomousPayoutDaemon"
$scriptRoot = Split-Path -Parent $PSScriptRoot
$projectRoot = Split-Path -Parent $scriptRoot
$nodePath = "node"
$daemonScript = Join-Path $scriptRoot "mcp\autonomous_daemon.mjs"
$logDir = Join-Path $projectRoot ".swarm"
$logFile = Join-Path $logDir "daemon.log"

if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

if ($Status) {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($task) {
        Write-Host "Task: $taskName"
        Write-Host "State: $($task.State)"
        Write-Host "Last Run: $($task.LastRunTime)"
        Write-Host "Last Result: $($task.LastTaskResult)"
    } else {
        Write-Host "Task not installed."
    }
    return
}

if ($Uninstall) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Uninstalled $taskName"
    return
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -Command `"cd '$projectRoot'; `$env:PATH = 'C:\Users\Dell\AppData\Local\Python\bin;' + `$env:PATH; node '$daemonScript' >> '$logFile' 2>&1`""

$trigger = New-ScheduledTaskTrigger -AtStartup -RandomDelay "00:01:00"

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 10 `
    -RestartInterval (New-TimeSpan -Minutes 5) `
    -ExecutionTimeLimit 0 `
    -Priority 7

$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Force

Write-Host "=== INSTALLED ==="
Write-Host "Name:  $taskName"
Write-Host "Start: At system boot (auto)"
Write-Host "Node:  $nodePath"
Write-Host "Cmd:   node $daemonScript"
Write-Host "Log:   $logFile"
Write-Host ""
Write-Host "Start now: Start-ScheduledTask -TaskName '$taskName'"
Write-Host "Stop:      Stop-ScheduledTask -TaskName '$taskName'"
Write-Host "Uninstall: powershell -File '$PSCommandPath' -Uninstall"
