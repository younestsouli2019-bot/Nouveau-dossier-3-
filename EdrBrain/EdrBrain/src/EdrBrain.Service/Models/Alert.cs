namespace EdrBrain.Models;

/// <summary>
/// Represents an alert raised by the detection engine.
/// Stored in SQLite for forensic history and dashboard display.
/// </summary>
public sealed class Alert
{
    public long Id { get; set; }
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
    public string RuleId { get; set; } = string.Empty;
    public string RuleTitle { get; set; } = string.Empty;
    public string Level { get; set; } = "medium";
    public int Score { get; set; }
    public string Host { get; set; } = Environment.MachineName;
    public int RootPid { get; set; }
    public string RootProcessName { get; set; } = string.Empty;
    public string CommandLine { get; set; } = string.Empty;
    public List<string> Tactics { get; set; } = new();
    public List<string> Techniques { get; set; } = new();
    public string Response { get; set; } = "none";
    public string Status { get; set; } = "new";  // new | triaged | resolved | false_positive
}
