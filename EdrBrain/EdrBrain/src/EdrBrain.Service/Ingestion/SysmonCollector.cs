using System.Diagnostics.Eventing.Reader;
using System.Threading.Channels;
using EdrBrain.Models;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace EdrBrain.Ingestion;

/// <summary>
/// Production Sysmon collector using EventLogWatcher for push-based
/// event delivery with a bounded Channel for backpressure management.
///
/// Architecture:
///   EventLogWatcher callback → Channel (bounded, 10K) → Consumer task
///
/// The watcher callback enqueues events and returns immediately, preventing
/// event loss if the consumer (parsing + DB write) falls behind.
/// The bounded channel with DropOldest ensures memory stays bounded
/// even during extreme event bursts.
/// </summary>
public sealed class SysmonCollector : ISysmonReader
{
    private readonly ILogger<SysmonCollector> _logger;
    private readonly EdrOptions _options;
    private readonly EventParser _parser;
    private readonly Channel<NormalizedEvent> _channel;
    private EventLogWatcher? _watcher;
    private bool _isHealthy;
    private int _eventsDropped;

    public bool IsHealthy => _isHealthy;

    public SysmonCollector(
        ILogger<SysmonCollector> logger,
        IOptions<EdrOptions> options,
        EventParser parser)
    {
        _logger = logger;
        _options = options.Value;
        _parser = parser;
        _isHealthy = false;
        _eventsDropped = 0;

        _channel = Channel.CreateBounded<NormalizedEvent>(
            new BoundedChannelOptions(_options.ChannelCapacity)
            {
                FullMode = BoundedChannelFullMode.DropOldest,
                SingleReader = true,
                SingleWriter = true,
            });
    }

    /// <inheritdoc />
    public void Start()
    {
        try
        {
            _watcher = new EventLogWatcher(_options.SysmonChannel);
            _watcher.EventRecordWritten += OnEventRecordWritten;
            _watcher.Enabled = true;
            _isHealthy = true;

            _logger.LogInformation(
                "Sysmon collector started. Channel={Channel}, Watching={Log}",
                _options.ChannelCapacity, _options.SysmonChannel);
        }
        catch (EventLogNotFoundException ex)
        {
            _logger.LogCritical(ex,
                "Sysmon event log '{Channel}' not found. Is Sysmon installed?",
                _options.SysmonChannel);
            _isHealthy = false;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to start Sysmon collector");
            _isHealthy = false;
        }
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<NormalizedEvent> ReadAllAsync(
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct)
    {
        await foreach (var evt in _channel.Reader.ReadAllAsync(ct))
        {
            yield return evt;
        }
    }

    /// <inheritdoc />
    public IEnumerable<NormalizedEvent> GetEventsSince(DateTime since)
    {
        var events = new List<NormalizedEvent>();

        try
        {
            var query = new EventLogQuery(_options.SysmonChannel, PathType.LogName,
                $"*[System[TimeCreated[@SystemTime >= '{since:O}']]]");

            using var reader = new EventLogReader(query);
            for (var record = reader.ReadEvent(); record != null; record = reader.ReadEvent())
            {
                if (record.TimeCreated.HasValue && record.TimeCreated.Value < since)
                    continue;

                var evtIds = _options.MonitoredEventIds;
                if (!evtIds.Contains(record.Id))
                    continue;

                var norm = _parser.ParseEvent(record);
                if (norm != null)
                    events.Add(norm);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Fallback batch read failed for events since {Since}", since);
        }

        _logger.LogDebug("Fallback read recovered {Count} events since {Since}", events.Count, since);
        return events;
    }

    // ── Private ────────────────────────────────────────────────

    private void OnEventRecordWritten(object? sender, EventRecordWrittenEventArgs e)
    {
        if (e.EventRecord == null)
            return;

        var eventId = e.EventRecord.Id;
        if (!_options.MonitoredEventIds.Contains(eventId))
            return;

        try
        {
            var norm = _parser.ParseEvent(e.EventRecord);
            if (norm == null)
                return;

            if (!_channel.Writer.TryWrite(norm))
            {
                Interlocked.Increment(ref _eventsDropped);
                if (_eventsDropped % 1000 == 0)
                {
                    _logger.LogWarning("Dropped {Count} events due to channel backpressure", _eventsDropped);
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Error parsing Sysmon EventID {EventId}", eventId);
        }
    }

    public void Dispose()
    {
        _watcher?.Dispose();
        _channel.Writer.TryComplete();
    }
}
