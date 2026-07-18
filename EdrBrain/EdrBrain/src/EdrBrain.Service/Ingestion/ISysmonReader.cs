using EdrBrain.Models;

namespace EdrBrain.Ingestion;

/// <summary>
/// Interface for Sysmon event collection. The production implementation
/// uses EventLogWatcher (push model). Tests can substitute a mock.
/// </summary>
public interface ISysmonReader : IDisposable
{
    /// <summary>
    /// Start watching the Sysmon event log for new events.
    /// Events are delivered via the ReadAllAsync enumerable.
    /// </summary>
    void Start();

    /// <summary>
    /// Read all incoming events as an async stream.
    /// Blocks asynchronously until events are available.
    /// </summary>
    IAsyncEnumerable<NormalizedEvent> ReadAllAsync(CancellationToken ct);

    /// <summary>
    /// Perform a one-time batch read of events since the given timestamp.
    /// Used as a fallback to catch any events missed by the watcher
    /// (e.g., during service startup).
    /// </summary>
    IEnumerable<NormalizedEvent> GetEventsSince(DateTime since);

    /// <summary>
    /// Current health status of the collector.
    /// </summary>
    bool IsHealthy { get; }
}
