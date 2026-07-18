using System.Text.RegularExpressions;
using EdrBrain.Models;

namespace EdrBrain.Engine;

/// <summary>
/// Maps process behaviors to MITRE ATT&CK tactics and techniques.
/// Provides both per-event and per-chain mapping.
///
/// Technique IDs follow the MITRE ATT&CK v14 taxonomy:
///   T1059.001 = PowerShell
///   T1055     = Process Injection
///   T1547.001 = Boot or Logon Autostart Execution: Registry Run Keys
///   etc.
/// </summary>
public sealed class MitreMapper
{
    /// <summary>
    /// Map a single normalized event to MITRE tactics and techniques.
    /// </summary>
    public (List<string> tactics, List<string> techniques) MapEvent(NormalizedEvent evt)
    {
        var tactics = new List<string>();
        var techniques = new List<string>();

        switch (evt.ActionType)
        {
            case SysmonAction.ProcessCreate:
                MapProcessCreate(evt, tactics, techniques);
                break;

            case SysmonAction.NetworkConnect:
                MapNetworkConnect(evt, tactics, techniques);
                break;

            case SysmonAction.RegistrySetValue:
                MapRegistrySetValue(evt, tactics, techniques);
                break;

            case SysmonAction.CreateRemoteThread:
                tactics.Add("Defense Evasion");
                techniques.Add("T1055"); // Process Injection
                break;

            case SysmonAction.ProcessAccess:
                MapProcessAccess(evt, tactics, techniques);
                break;

            case SysmonAction.FileCreate:
                MapFileCreate(evt, tactics, techniques);
                break;

            case SysmonAction.ImageLoaded:
                MapImageLoaded(evt, tactics, techniques);
                break;
        }

        return (tactics.Distinct().ToList(), techniques.Distinct().ToList());
    }

    /// <summary>
    /// Map an entire attack chain to MITRE tactics and techniques.
    /// Aggregates signals from all nodes in the chain.
    /// </summary>
    public (List<string> tactics, List<string> techniques) MapChain(List<ProcessNode> chain)
    {
        var allTactics = new List<string>();
        var allTechniques = new List<string>();

        foreach (var node in chain)
        {
            var name = node.Name.ToLowerInvariant();
            var cmd = node.CommandLine.ToLowerInvariant();

            // Execution
            if (name.Contains("powershell"))
            {
                allTactics.Add("Execution");
                allTechniques.Add("T1059.001");
                if (cmd.Contains("-enc") || cmd.Contains("-encodedcommand"))
                    allTechniques.Add("T1027"); // Obfuscated Files/Info
            }
            if (name.Contains("wscript") || name.Contains("cscript"))
            {
                allTactics.Add("Execution");
                allTechniques.Add("T1059.005"); // Visual Basic
            }
            if (name.Contains("cmd.exe"))
            {
                allTactics.Add("Execution");
                allTechniques.Add("T1059.003"); // Windows Command Shell
            }
            if (name.Contains("mshta.exe"))
            {
                allTactics.Add("Defense Evasion");
                allTechniques.Add("T1218.005"); // Mshta
            }

            // LOLBins
            if (name.Contains("certutil"))
            {
                allTactics.Add("Defense Evasion");
                allTechniques.Add("T1218.009"); // Certutil
            }
            if (name.Contains("rundll32"))
            {
                allTactics.Add("Defense Evasion");
                allTechniques.Add("T1218.011"); // Rundll32
            }
            if (name.Contains("bitsadmin"))
            {
                allTactics.Add("Defense Evasion");
                allTechniques.Add("T1197"); // BITS Jobs
            }

            // Persistence
            if (cmd.Contains(@"\run\") || cmd.Contains(@"\runonce\") ||
                cmd.Contains("currentversion\\run"))
            {
                allTactics.Add("Persistence");
                allTechniques.Add("T1547.001"); // Registry Run Keys
            }
            if (cmd.Contains("schtasks"))
            {
                allTactics.Add("Persistence");
                allTechniques.Add("T1053.005"); // Scheduled Task
            }

            // Credential Access
            if (cmd.Contains("lsass") || cmd.Contains("mimikatz") ||
                cmd.Contains("procdump") || cmd.Contains("sekurlsa"))
            {
                allTactics.Add("Credential Access");
                allTechniques.Add("T1003.001"); // LSASS Memory
            }

            // Lateral Movement
            if (cmd.Contains("wmic") && cmd.Contains("node:"))
            {
                allTactics.Add("Lateral Movement");
                allTechniques.Add("T1047"); // WMI
            }
        }

        // Cross-node: if chain has network + LOLBin → C2
        if (chain.Any(n => n.CommandLine.Contains("http://", StringComparison.OrdinalIgnoreCase) ||
                           n.CommandLine.Contains("https://", StringComparison.OrdinalIgnoreCase)))
        {
            allTactics.Add("Command and Control");
            allTechniques.Add("T1071"); // Application Layer Protocol
        }

        return (allTactics.Distinct().ToList(), allTechniques.Distinct().ToList());
    }

    // ── Per-Event Mapping Helpers ──────────────────────────────

    private static void MapProcessCreate(NormalizedEvent evt, List<string> t, List<string> tech)
    {
        var name = Path.GetFileName(evt.ProcessName).ToLowerInvariant();
        var cmd = evt.CommandLine.ToLowerInvariant();

        if (name.Contains("powershell"))
        {
            t.Add("Execution"); tech.Add("T1059.001");
            if (cmd.Contains("-enc")) tech.Add("T1027");
        }
        if (name.Contains("cmd.exe")) { t.Add("Execution"); tech.Add("T1059.003"); }
        if (name.Contains("wscript") || name.Contains("cscript"))
        { t.Add("Execution"); tech.Add("T1059.005"); }
        if (name.Contains("mshta")) { t.Add("Defense Evasion"); tech.Add("T1218.005"); }
        if (name.Contains("certutil")) { t.Add("Defense Evasion"); tech.Add("T1218.009"); }
        if (name.Contains("mimikatz") || name.Contains("procdump"))
        { t.Add("Credential Access"); tech.Add("T1003.001"); }
        if (cmd.Contains("schtasks")) { t.Add("Persistence"); tech.Add("T1053.005"); }
    }

    private static void MapNetworkConnect(NormalizedEvent evt, List<string> t, List<string> tech)
    {
        // Parse destination port from Target field (format: "IP:port")
        var target = evt.Target;
        if (target.Contains(':') && int.TryParse(target.Split(':').Last(), out var port))
        {
            if (port == 3389) { t.Add("Lateral Movement"); tech.Add("T1021.001"); } // RDP
            if (port == 445)  { t.Add("Lateral Movement"); tech.Add("T1021.002"); } // SMB
            if (port == 135)  { t.Add("Lateral Movement"); tech.Add("T1047"); }      // WMI
            if (port == 443 || port == 80)
            { t.Add("Command and Control"); tech.Add("T1071.001"); } // HTTP/S
            if (port == 53)  { t.Add("Command and Control"); tech.Add("T1071.004"); } // DNS
            if (port == 88)  { t.Add("Credential Access"); tech.Add("T1558"); }       // Kerberos
        }
    }

    private static void MapRegistrySetValue(NormalizedEvent evt, List<string> t, List<string> tech)
    {
        var target = evt.Target.ToLowerInvariant();
        if (target.Contains(@"\run\") || target.Contains(@"\runonce\") ||
            target.Contains("currentversion\\run"))
        {
            t.Add("Persistence"); tech.Add("T1547.001");
        }
        if (target.Contains(@"\services\") && target.Contains("imagepath"))
        {
            t.Add("Persistence"); tech.Add("T1543.003"); // Windows Service
        }
    }

    private static void MapProcessAccess(NormalizedEvent evt, List<string> t, List<string> tech)
    {
        var target = evt.Target.ToLowerInvariant();
        if (target.Contains("lsass"))
        {
            t.Add("Credential Access"); tech.Add("T1003.001");
            if (target.Contains("0x1010") || target.Contains("0x1410"))
            {
                tech.Add("T1003"); // OS Credential Dumping (parent)
            }
        }
    }

    private static void MapFileCreate(NormalizedEvent evt, List<string> t, List<string> tech)
    {
        var target = evt.Target.ToLowerInvariant();
        if (target.Contains(@"\appdata\") && target.EndsWith(".exe"))
        { t.Add("Persistence"); tech.Add("T1547.001"); }
        if (target.Contains("login data") || target.Contains("cookies") || target.Contains("webdata"))
        { t.Add("Credential Access"); tech.Add("T1555.003"); } // Credentials from Web Browsers
    }

    private static void MapImageLoaded(NormalizedEvent evt, List<string> t, List<string> tech)
    {
        var target = evt.Target.ToLowerInvariant();
        if (target.Contains("gdi32.dll") || target.Contains("user32.dll"))
        { t.Add("Collection"); tech.Add("T1113"); } // Screen Capture (potential)
    }
}
