namespace EdrBrain.Models;

/// <summary>
/// Represents a Sigma-compatible detection rule loaded from JSON.
/// Rules are hot-reloadable and can be added/modified without restarting the service.
/// </summary>
public sealed class SigmaRule
{
    public string Id { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string Author { get; set; } = string.Empty;
    public string Date { get; set; } = string.Empty;
    public string Status { get; set; } = "experimental";
    public string Level { get; set; } = "medium";
    public List<string> Tags { get; set; } = new();
    public List<string> FalsePositives { get; set; } = new();
    public DetectionLogic Detection { get; set; } = new();
}

public sealed class DetectionLogic
{
    /// <summary>
    /// Key-value pairs that must ALL match for the rule to fire (AND logic).
    /// Keys are NormalizedEvent property names; values are match patterns
    /// supporting wildcards (*) and pipe-separated OR values.
    /// </summary>
    public Dictionary<string, string> Selection { get; set; } = new();

    /// <summary>
    /// Optional condition expression for complex logic.
    /// Example: "selection1 and not selection2"
    /// </summary>
    public string? Condition { get; set; }

    /// <summary>
    /// Time window for correlation rules (e.g., "00:05:00" for 5 minutes).
    /// </summary>
    public TimeSpan? Timeframe { get; set; }
}

public enum RuleLevel
{
    Critical = 4,
    High     = 3,
    Medium   = 2,
    Low      = 1,
    Info     = 0,
}
