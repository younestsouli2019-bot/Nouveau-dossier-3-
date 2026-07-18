using EdrBrain.Models;

namespace EdrBrain.Engine;

/// <summary>
/// Interface for the attack graph engine.
/// </summary>
public interface IGraphEngine
{
    /// <summary> Add an event to the graph. Only ProcessCreate events add nodes/edges. </summary>
    void AddEvent(NormalizedEvent evt);

    /// <summary> Mark a process as terminated (from Sysmon EID 5). </summary>
    void MarkTerminated(int pid);

    /// <summary>
    /// Perform incremental analysis on the subgraph affected by the given PID.
    /// Returns any new attack chains found.
    /// </summary>
    List<AttackChain> AnalyzeSubgraph(int rootPid);

    /// <summary> Full scan for attack chains (used periodically as a safety net). </summary>
    List<AttackChain> FindAllAttackChains();

    /// <summary> Prune terminated-process nodes older than the retention window. </summary>
    int PruneStaleNodes(TimeSpan retentionWindow);

    /// <summary> Get current in-memory node count. </summary>
    int ActiveNodeCount { get; }

    /// <summary> Persist all in-memory nodes to storage. </summary>
    Task PersistAsync(CancellationToken ct = default);

    /// <summary> Load nodes from storage into memory. </summary>
    void LoadFromStorage();
}
