namespace EdrBrain.Models;

/// <summary>
/// Represents a detected attack chain — a sequence of related processes
/// forming a kill-chain from a suspicious root through child processes.
/// </summary>
public sealed class AttackChain
{
    public int ChainId { get; set; }
    public int RootPid { get; set; }
    public int Score { get; set; }
    public List<string> Tactics { get; set; } = new();
    public List<string> Techniques { get; set; } = new();
    public DateTime DetectedAt { get; set; } = DateTime.UtcNow;
    public string Response { get; set; } = "none";
    public DateTime? RespondedAt { get; set; }

    /// <summary>
    /// Ordered list of process nodes in this chain, from root to leaf.
    /// </summary>
    public List<ProcessNode> Members { get; set; } = new();

    /// <summary>
    /// True if this chain's score exceeds the configurable threshold.
    /// </summary>
    public bool ExceedsThreshold(int threshold) => Score >= threshold;
}
