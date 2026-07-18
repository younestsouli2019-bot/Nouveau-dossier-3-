using EdrBrain.Models;

namespace EdrBrain.Storage;

/// <summary>
/// Interface for persistent state and event storage.
/// </summary>
public interface IStateManager : IDisposable
{
    /// <summary> Get the last-read timestamp from the state store. </summary>
    DateTime GetLastReadTime();

    /// <summary> Persist the last-read timestamp. </summary>
    void SetLastReadTime(DateTime time);

    /// <summary> Insert a batch of normalized events. </summary>
    Task InsertEventsBatchAsync(IEnumerable<NormalizedEvent> events, CancellationToken ct = default);

    /// <summary> Query events within a time range. </summary>
    IEnumerable<NormalizedEvent> QueryEvents(DateTime from, DateTime to, string? actionFilter = null);

    /// <summary> Delete events older than the retention period. </summary>
    Task PruneOldEventsAsync(int retentionDays, CancellationToken ct = default);

    /// <summary> Persist graph nodes and edges. </summary>
    Task SaveGraphNodesAsync(IEnumerable<ProcessNode> nodes, CancellationToken ct = default);

    /// <summary> Load all active (non-terminated) graph nodes from storage. </summary>
    IEnumerable<ProcessNode> LoadActiveNodes();

    /// <summary> Save an attack chain. </summary>
    Task SaveAttackChainAsync(AttackChain chain, CancellationToken ct = default);

    /// <summary> Save an alert. </summary>
    Task SaveAlertAsync(Alert alert, CancellationToken ct = default);

    /// <summary> Initialize the database schema (idempotent). </summary>
    Task InitializeSchemaAsync(CancellationToken ct = default);

    /// <summary> Get current database size in bytes. </summary>
    long GetDatabaseSizeBytes();

    /// <summary> Get the count of events in the database. </summary>
    long GetEventCount();
}
