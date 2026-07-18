using System.Diagnostics;
using EdrBrain.Models;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace EdrBrain.Response;

/// <summary>
/// Targeted containment engine with configurable response policies.
///
/// Policies (from least to most aggressive):
///   - AlertOnly:    Log + notify only (default for safety)
///   - Suspend:      Suspend the root process (preserves memory for forensics)
///   - KillProcessTree: Kill the entire process tree
///   - Disabled:     No automated response
///
/// Safety features:
///   - Cooldown period prevents repeated response to the same chain
///   - Critical process protection: never kill lsass, svchost, csrss, etc.
///   - All actions are logged to both the event log and the database
///   - Response failures are logged but do NOT crash the service
/// </summary>
public sealed class ResponseEngine : IResponseEngine
{
    private readonly ILogger<ResponseEngine> _logger;
    private readonly EdrOptions _options;
    private readonly IAlertService _alertService;
    private readonly HashSet<int> _recentlyResponded = new();
    private readonly object _cooldownLock = new();

    // Processes that must NEVER be killed (system-critical)
    private static readonly HashSet<string> ProtectedProcesses = new(StringComparer.OrdinalIgnoreCase)
    {
        "lsass.exe", "svchost.exe", "csrss.exe", "smss.exe",
        "wininit.exe", "services.exe", "winlogon.exe", "dwm.exe",
        "System", "Registry", "MemCompression",
    };

    public ResponseEngine(
        ILogger<ResponseEngine> logger,
        IOptions<EdrOptions> options,
        IAlertService alertService)
    {
        _logger = logger;
        _options = options.Value;
        _alertService = alertService;
    }

    public async Task<string> RespondAsync(AttackChain chain, CancellationToken ct = default)
    {
        // Check cooldown — don't respond to the same root PID twice in the window
        lock (_cooldownLock)
        {
            if (_recentlyResponded.Contains(chain.RootPid))
                return "cooldown";

            _recentlyResponded.Add(chain.RootPid);
        }

        // Clean up cooldown set periodically
        _ = Task.Run(async () =>
        {
            await Task.Delay(TimeSpan.FromSeconds(_options.ResponseCooldownSeconds));
            lock (_cooldownLock) { _recentlyResponded.Remove(chain.RootPid); }
        });

        var action = _options.ResponsePolicy switch
        {
            ResponsePolicy.AlertOnly      => await ExecuteAlertOnly(chain),
            ResponsePolicy.Suspend        => await ExecuteSuspend(chain),
            ResponsePolicy.KillProcessTree => await ExecuteKillProcessTree(chain),
            ResponsePolicy.Disabled       => "disabled",
            _                             => "alerted",
        };

        chain.Response = action;
        chain.RespondedAt = DateTime.UtcNow;

        _logger.LogWarning(
            "Response executed: Action={Action}, RootPid={Pid}, Score={Score}, ChainLength={Len}",
            action, chain.RootPid, chain.Score, chain.Members.Count);

        return action;
    }

    // ── Response Actions ───────────────────────────────────────

    private async Task<string> ExecuteAlertOnly(AttackChain chain)
    {
        await _alertService.RaiseAlertAsync(new Alert
        {
            RuleId = "graph-chain",
            RuleTitle = "Suspicious Attack Chain Detected",
            Level = chain.Score >= 100 ? "critical" : chain.Score >= 75 ? "high" : "medium",
            Score = chain.Score,
            RootPid = chain.RootPid,
            RootProcessName = chain.Members.FirstOrDefault()?.Name ?? "unknown",
            CommandLine = chain.Members.FirstOrDefault()?.CommandLine ?? "",
            Tactics = chain.Tactics,
            Techniques = chain.Techniques,
            Response = "alerted",
        });

        return "alerted";
    }

    private async Task<string> ExecuteSuspend(AttackChain chain)
    {
        // Alert first
        await ExecuteAlertOnly(chain);

        var root = chain.Members.FirstOrDefault();
        if (root == null) return "alerted";

        // Protect system-critical processes
        if (ProtectedProcesses.Contains(root.Name))
        {
            _logger.LogWarning("Refusing to suspend protected process: {Name} (PID {Pid})", root.Name, root.Pid);
            return "protected";
        }

        try
        {
            var process = Process.GetProcessById(root.Pid);
            // Suspend by freezing all threads (Windows doesn't have a native suspend API
            // for entire processes, so we use NtSuspendProcess via P/Invoke)
            if (SuspendProcess(process.Handle))
            {
                _logger.LogWarning("Suspended process {Name} (PID {Pid})", root.Name, root.Pid);
                return "suspended";
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to suspend process PID {Pid}", root.Pid);
        }

        return "alerted"; // Fallback to alert-only
    }

    private async Task<string> ExecuteKillProcessTree(AttackChain chain)
    {
        // Alert first
        await ExecuteAlertOnly(chain);

        var root = chain.Members.FirstOrDefault();
        if (root == null) return "alerted";

        // Protect system-critical processes
        if (ProtectedProcesses.Contains(root.Name))
        {
            _logger.LogWarning("Refusing to kill protected process: {Name} (PID {Pid})", root.Name, root.Pid);
            return "protected";
        }

        try
        {
            var process = Process.GetProcessById(root.Pid);
            process.Kill(entireProcessTree: true);

            _logger.LogWarning("Killed process tree rooted at {Name} (PID {Pid})", root.Name, root.Pid);

            // Write to Windows Event Log for forensics
            try
            {
                EventLog.WriteEntry("Application",
                    $"EdrBrain: Contained attack chain starting with {root.Name} (PID {root.Pid}). " +
                    $"Score: {chain.Score}. Tactics: {string.Join(", ", chain.Tactics)}",
                    EventLogEntryType.Warning, 100);
            }
            catch { /* Event log write failure is non-critical */ }

            return "killed";
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to kill process tree rooted at PID {Pid}", root.Pid);
            return "alerted"; // Fallback to alert-only
        }
    }

    // ── P/Invoke for Process Suspension ────────────────────────

    [System.Runtime.InteropServices.DllImport("ntdll.dll", SetLastError = true)]
    private static extern int NtSuspendProcess(IntPtr processHandle);

    private static bool SuspendProcess(IntPtr handle)
    {
        try
        {
            return NtSuspendProcess(handle) >= 0;
        }
        catch
        {
            return false;
        }
    }
}
