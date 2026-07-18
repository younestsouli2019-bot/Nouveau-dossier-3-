using EdrBrain.Models;
using EdrBrain.Storage;
using Microsoft.Extensions.Logging;

namespace EdrBrain.Response;

/// <summary>
/// Alert service that persists alerts to the database and optionally
/// forwards them to external systems (SIEM, webhook, email).
/// </summary>
public sealed class AlertService : IAlertService
{
    private readonly ILogger<AlertService> _logger;
    private readonly IStateManager _state;
    private readonly List<Func<Alert, CancellationToken, Task>> _handlers = new();

    public AlertService(ILogger<AlertService> logger, IStateManager state)
    {
        _logger = logger;
        _state = state;
    }

    /// <summary>
    /// Register an external alert handler (e.g., webhook, SIEM forwarder).
    /// </summary>
    public void AddHandler(Func<Alert, CancellationToken, Task> handler)
    {
        _handlers.Add(handler);
    }

    /// <inheritdoc />
    public async Task RaiseAlertAsync(Alert alert, CancellationToken ct = default)
    {
        // Persist to database
        try
        {
            await _state.SaveAlertAsync(alert, ct);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to persist alert for {Rule}", alert.RuleTitle);
        }

        // Log to console/event log
        _logger.LogWarning(
            "ALERT [{Level}] {Title} | PID={Pid} Proc={Proc} Score={Score} Tactics={Tactics}",
            alert.Level.ToUpperInvariant(),
            alert.RuleTitle,
            alert.RootPid,
            alert.RootProcessName,
            alert.Score,
            string.Join(",", alert.Tactics));

        // Forward to external handlers
        foreach (var handler in _handlers)
        {
            try
            {
                await handler(alert, ct);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "External alert handler failed");
            }
        }
    }
}

/// <summary>
/// Interface for the alert service.
/// </summary>
public interface IAlertService
{
    Task RaiseAlertAsync(Alert alert, CancellationToken ct = default);
}
