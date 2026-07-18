namespace EdrBrain.Models;

/// <summary>
/// Represents a single process node in the attack graph.
/// Nodes are persisted to SQLite so the graph survives service restarts.
/// </summary>
public sealed class ProcessNode
{
    public int Pid { get; set; }
    public string Name { get; set; } = string.Empty;
    public string CommandLine { get; set; } = string.Empty;
    public string Hash { get; set; } = string.Empty;
    public SignatureStatus Signature { get; set; } = SignatureStatus.Unknown;
    public int? ParentPid { get; set; }
    public string ParentName { get; set; } = string.Empty;
    public DateTime StartTime { get; set; } = DateTime.UtcNow;
    public DateTime? EndTime { get; set; }
    public int RiskScore { get; set; }
    public bool IsSuspiciousRoot { get; set; }

    /// <summary>
    /// True if the process has terminated (EndTime set and in the past).
    /// </summary>
    public bool IsTerminated => EndTime.HasValue && EndTime.Value < DateTime.UtcNow;

    /// <summary>
    /// True if this node is eligible for pruning (terminated more than
    /// the configured retention window ago).
    /// </summary>
    public bool IsEligibleForPruning(TimeSpan retentionWindow) =>
        IsTerminated && EndTime!.Value < DateTime.UtcNow - retentionWindow;
}
