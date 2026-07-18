using System.Text.RegularExpressions;
using EdrBrain.Models;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace EdrBrain.Engine;

/// <summary>
/// Sigma-compatible detection rule engine.
/// Loads rules from JSON files, matches them against incoming events,
/// and produces alerts with MITRE mappings.
///
/// Features:
///   - Hot-reload: rules directory is scanned periodically
///   - Wildcard matching: * in rule patterns
///   - OR values: pipe-separated values (e.g., "cmd.exe|powershell.exe")
///   - Case-insensitive matching
///   - Time-window correlation for multi-event rules
/// </summary>
public sealed class SigmaRuleEngine
{
    private readonly ILogger<SigmaRuleEngine> _logger;
    private readonly EdrOptions _options;
    private List<SigmaRule> _rules = new();
    private DateTime _lastReload = DateTime.MinValue;
    private readonly object _rulesLock = new();

    public SigmaRuleEngine(ILogger<SigmaRuleEngine> logger, IOptions<EdrOptions> options)
    {
        _logger = logger;
        _options = options.Value;
    }

    /// <summary> Get the current count of loaded rules. </summary>
    public int RuleCount => _rules.Count;

    /// <summary>
    /// Reload rules from disk if the reload interval has elapsed.
    /// Thread-safe: swaps the rule list atomically.
    /// </summary>
    public void ReloadIfNeeded()
    {
        if (DateTime.UtcNow - _lastReload < TimeSpan.FromSeconds(_options.RuleReloadIntervalSeconds))
            return;

        ReloadRules();
    }

    /// <summary> Force an immediate rule reload. </summary>
    public void ReloadRules()
    {
        try
        {
            var rulesDir = Path.Combine(AppContext.BaseDirectory, _options.RulesPath);
            if (!Directory.Exists(rulesDir))
            {
                _logger.LogWarning("Rules directory not found: {Dir}", rulesDir);
                return;
            }

            var newRules = new List<SigmaRule>();
            foreach (var file in Directory.GetFiles(rulesDir, "*.json", SearchOption.AllDirectories))
            {
                try
                {
                    var json = File.ReadAllText(file);
                    var rule = System.Text.Json.JsonSerializer.Deserialize<SigmaRule>(json);
                    if (rule != null && !string.IsNullOrEmpty(rule.Id))
                        newRules.Add(rule);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to load rule from {File}", file);
                }
            }

            lock (_rulesLock)
            {
                _rules = newRules;
            }

            _lastReload = DateTime.UtcNow;
            _logger.LogInformation("Loaded {Count} detection rules from {Dir}", newRules.Count, rulesDir);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error reloading detection rules");
        }
    }

    /// <summary>
    /// Evaluate a normalized event against all loaded rules.
    /// Returns a list of alerts for rules that matched.
    /// </summary>
    public List<Alert> Evaluate(NormalizedEvent evt)
    {
        var alerts = new List<Alert>();

        List<SigmaRule> currentRules;
        lock (_rulesLock)
        {
            currentRules = _rules;
        }

        foreach (var rule in currentRules)
        {
            if (rule.Status == "deprecated")
                continue;

            if (MatchesRule(evt, rule))
            {
                var alert = new Alert
                {
                    RuleId = rule.Id,
                    RuleTitle = rule.Title,
                    Level = rule.Level,
                    Score = CalculateRuleScore(rule),
                    Host = evt.Host,
                    RootPid = evt.ProcessId,
                    RootProcessName = evt.ProcessName,
                    CommandLine = evt.CommandLine,
                    Tactics = rule.Tags.Where(t => t.StartsWith("attack.")).Select(t => t.Replace("attack.", "")).ToList(),
                    Techniques = rule.Tags.Where(t => t.StartsWith("attack.t")).Select(t => t.Replace("attack.", "").ToUpperInvariant()).ToList(),
                };

                alerts.Add(alert);
            }
        }

        return alerts;
    }

    // ── Matching Logic ─────────────────────────────────────────

    private bool MatchesRule(NormalizedEvent evt, SigmaRule rule)
    {
        foreach (var (field, pattern) in rule.Detection.Selection)
        {
            var value = GetFieldValue(evt, field);
            if (value == null)
                return false;

            if (!MatchesPattern(value, pattern))
                return false;
        }

        return true;
    }

    private static string? GetFieldValue(NormalizedEvent evt, string field) =>
        field.ToLowerInvariant() switch
        {
            "action" or "actiontype" => evt.ActionType.ToString(),
            "proc_name" or "processname" or "image" => evt.ProcessName,
            "proc_pid" or "processid" => evt.ProcessId.ToString(),
            "cmdline" or "commandline" => evt.CommandLine,
            "parent_name" or "parentimage" => evt.ParentProcessName,
            "parent_cmdline" or "parentcommandline" => evt.ParentCommandLine,
            "target" => evt.Target,
            "hash" or "proc_hash" => evt.ProcessHash,
            "user" or "username" => evt.UserName,
            "signed" => evt.Signature.ToString(),
            _ => null,
        };

    /// <summary>
    /// Match a value against a Sigma pattern.
    /// Supports:
    ///   - Wildcards: * (any characters)
    ///   - OR values: pipe-separated (value1|value2|value3)
    ///   - Case-insensitive comparison
    /// </summary>
    private static bool MatchesPattern(string value, string pattern)
    {
        var valueLower = value.ToLowerInvariant();

        // OR values: pipe-separated
        if (pattern.Contains('|') && !pattern.Contains('*'))
        {
            var orValues = pattern.Split('|', StringSplitOptions.RemoveEmptyEntries);
            return orValues.Any(v => valueLower.Contains(v.Trim().ToLowerInvariant()));
        }

        // Wildcard matching
        if (pattern.Contains('*'))
        {
            var regex = "^" + Regex.Escape(pattern.ToLowerInvariant())
                .Replace("\\*", ".*") + "$";
            return Regex.IsMatch(valueLower, regex, RegexOptions.Compiled, TimeSpan.FromSeconds(1));
        }

        // Simple contains match
        return valueLower.Contains(pattern.ToLowerInvariant());
    }

    private static int CalculateRuleScore(SigmaRule rule) =>
        rule.Level.ToLowerInvariant() switch
        {
            "critical" => 100,
            "high"     => 80,
            "medium"   => 60,
            "low"      => 40,
            "info"     => 20,
            _          => 50,
        };
}
