using System.Threading.Channels;
using EdrBrain.Engine;
using EdrBrain.Ingestion;
using EdrBrain.Models;
using EdrBrain.Storage;
using Microsoft.Extensions.Options;

namespace EdrBrain;

/// <summary>
/// Hosted service #1: Collects Sysmon events and feeds them into the processing channel.
/// Also performs periodic fallback batch reads to catch any missed events.
/// </summary>
public sealed class EventCollector : BackgroundService
{
    private readonly ISysmonReader _reader;
    private readonly IStateManager _state;
    private readonly Channel<NormalizedEvent> _channel;
    private readonly EdrOptions _options;
    private readonly ILogger<EventCollector> _logger;

    public EventCollector(
        ISysmonReader reader,
        IStateManager state,
        Channel<NormalizedEvent> channel,
        IOptions<EdrOptions> options,
        ILogger<EventCollector> logger)
    {
        _reader = reader;
        _state = state;
        _channel = channel;
        _options = options.Value;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("EventCollector starting...");

        // Start the push-based watcher
        _reader.Start();

        // Perform a fallback read for events missed during startup
        await CatchUpAsync(stoppingToken);

        // Main loop: read from the push channel
        await foreach (var evt in _reader.ReadAllAsync(stoppingToken))
        {
            await _channel.Writer.WriteAsync(evt, stoppingToken);
        }
    }

    private async Task CatchUpAsync(CancellationToken ct)
    {
        var lastRead = _state.GetLastReadTime();
        var missedEvents = _reader.GetEventsSince(lastRead);

        int count = 0;
        foreach (var evt in missedEvents)
        {
            await _channel.Writer.WriteAsync(evt, ct);
            count++;
        }

        if (count > 0)
        {
            _logger.LogInformation("Caught up {Count} missed events since {Since}", count, lastRead);
        }
    }

    public override async Task StopAsync(CancellationToken ct)
    {
        _reader.Dispose();
        _channel.Writer.TryComplete();
        await base.StopAsync(ct);
    }
}

/// <summary>
/// Hosted service #2: Reads events from the channel, persists them,
/// runs graph analysis and Sigma rules, and produces alerts.
/// </summary>
public sealed class Correlator : BackgroundService
{
    private readonly Channel<NormalizedEvent> _eventChannel;
    private readonly Channel<Alert> _alertChannel;
    private readonly IStateManager _state;
    private readonly IGraphEngine _graph;
    private readonly SigmaRuleEngine _ruleEngine;
    private readonly MitreMapper _mitre;
    private readonly EdrOptions _options;
    private readonly ILogger<Correlator> _logger;

    private DateTime _lastPersist = DateTime.UtcNow;
    private DateTime _lastPrune = DateTime.UtcNow;
    private DateTime _lastFullScan = DateTime.UtcNow;

    public Correlator(
        Channel<NormalizedEvent> eventChannel,
        Channel<Alert> alertChannel,
        IStateManager state,
        IGraphEngine graph,
        SigmaRuleEngine ruleEngine,
        MitreMapper mitre,
        IOptions<EdrOptions> options,
        ILogger<Correlator> logger)
    {
        _eventChannel = eventChannel;
        _alertChannel = alertChannel;
        _state = state;
        _graph = graph;
        _ruleEngine = ruleEngine;
        _mitre = mitre;
        _options = options.Value;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Correlator starting...");

        // Load persisted graph from database
        _graph.LoadFromStorage();

        // Buffer for batch event persistence
        var eventBuffer = new List<NormalizedEvent>(_options.BatchInsertSize);
        var lastFlush = DateTime.UtcNow;

        await foreach (var evt in _eventChannel.Reader.ReadAllAsync(stoppingToken))
        {
            // 1. Add to graph engine (only ProcessCreate and ProcessTerminate)
            _graph.AddEvent(evt);

            // 2. Run Sigma rule engine
            var ruleAlerts = _ruleEngine.Evaluate(evt);
            foreach (var alert in ruleAlerts)
            {
                await _alertChannel.Writer.WriteAsync(alert, stoppingToken);
            }

            // 3. Incremental graph analysis for ProcessCreate events
            if (evt.ActionType == SysmonAction.ProcessCreate)
            {
                var chains = _graph.AnalyzeSubgraph(evt.ProcessId);
                foreach (var chain in chains.Where(c => c.ExceedsThreshold(_options.AlertThreshold)))
                {
                    await _alertChannel.Writer.WriteAsync(new Alert
                    {
                        RuleId = "graph-chain",
                        RuleTitle = "Suspicious Attack Chain Detected",
                        Level = chain.Score >= 100 ? "critical" : "high",
                        Score = chain.Score,
                        RootPid = chain.RootPid,
                        RootProcessName = chain.Members.FirstOrDefault()?.Name ?? "unknown",
                        CommandLine = chain.Members.FirstOrDefault()?.CommandLine ?? "",
                        Tactics = chain.Tactics,
                        Techniques = chain.Techniques,
                    }, stoppingToken);

                    // Persist chain
                    await _state.SaveAttackChainAsync(chain, stoppingToken);
                }
            }

            // 4. Buffer for batch persistence
            eventBuffer.Add(evt);

            // 5. Flush buffer periodically or when full
            if (eventBuffer.Count >= _options.BatchInsertSize ||
                DateTime.UtcNow - lastFlush > TimeSpan.FromSeconds(5))
            {
                await _state.InsertEventsBatchAsync(eventBuffer, stoppingToken);
                _state.SetLastReadTime(eventBuffer.Max(e => e.Timestamp));
                eventBuffer.Clear();
                lastFlush = DateTime.UtcNow;
            }

            // 6. Periodic maintenance
            await RunPeriodicTasksAsync(stoppingToken);
        }
    }

    private async Task RunPeriodicTasksAsync(CancellationToken ct)
    {
        var now = DateTime.UtcNow;

        // Prune stale graph nodes
        if (now - _lastPrune > TimeSpan.FromMinutes(_options.PruneIntervalMinutes))
        {
            _graph.PruneStaleNodes(TimeSpan.FromMinutes(_options.TerminatedProcessRetentionMinutes));
            _lastPrune = now;
        }

        // Persist graph to database
        if (now - _lastPersist > TimeSpan.FromMinutes(5))
        {
            await _graph.PersistAsync(ct);
            _lastPersist = now;
        }

        // Full graph scan as safety net
        if (now - _lastFullScan > TimeSpan.FromMinutes(15))
        {
            var chains = _graph.FindAllAttackChains();
            foreach (var chain in chains.Where(c => c.ExceedsThreshold(_options.AlertThreshold)))
            {
                await _alertChannel.Writer.WriteAsync(new Alert
                {
                    RuleId = "graph-fullscan",
                    RuleTitle = "Full Scan: Attack Chain Detected",
                    Level = "high",
                    Score = chain.Score,
                    RootPid = chain.RootPid,
                    RootProcessName = chain.Members.FirstOrDefault()?.Name ?? "unknown",
                    Tactics = chain.Tactics,
                    Techniques = chain.Techniques,
                }, ct);
            }
            _lastFullScan = now;
        }

        // Reload Sigma rules if interval has elapsed
        _ruleEngine.ReloadIfNeeded();

        // Prune old events from database
        if (now.Hour == 3 && now.Minute == 0) // 3 AM daily
        {
            await _state.PruneOldEventsAsync(_options.EventRetentionDays, ct);
        }
    }

    public override async Task StopAsync(CancellationToken ct)
    {
        // Persist graph on shutdown
        await _graph.PersistAsync(ct);
        _alertChannel.Writer.TryComplete();
        await base.StopAsync(ct);
    }
}

/// <summary>
/// Hosted service #3: Reads alerts from the channel and executes response actions.
/// </summary>
public sealed class ResponseCoordinator : BackgroundService
{
    private readonly Channel<Alert> _alertChannel;
    private readonly IResponseEngine _response;
    private readonly IAlertService _alertService;
    private readonly IStateManager _state;
    private readonly IGraphEngine _graph;
    private readonly ILogger<ResponseCoordinator> _logger;

    public ResponseCoordinator(
        Channel<Alert> alertChannel,
        IResponseEngine response,
        IAlertService alertService,
        IStateManager state,
        IGraphEngine graph,
        ILogger<ResponseCoordinator> logger)
    {
        _alertChannel = alertChannel;
        _response = response;
        _alertService = alertService;
        _state = state;
        _graph = graph;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("ResponseCoordinator starting...");

        await foreach (var alert in _alertChannel.Reader.ReadAllAsync(stoppingToken))
        {
            try
            {
                // Always persist and log the alert
                await _alertService.RaiseAlertAsync(alert, stoppingToken);

                // For graph-chain alerts, execute response policy
                if (alert.RuleId.StartsWith("graph-"))
                {
                    // Find the attack chain for this root PID
                    var chains = _graph.FindAllAttackChains()
                        .Where(c => c.RootPid == alert.RootPid)
                        .ToList();

                    foreach (var chain in chains)
                    {
                        var action = await _response.RespondAsync(chain, stoppingToken);
                        _logger.LogInformation("Response action: {Action} for PID {Pid}", action, chain.RootPid);
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error processing alert for {Rule} PID {Pid}",
                    alert.RuleTitle, alert.RootPid);
            }
        }
    }
}
