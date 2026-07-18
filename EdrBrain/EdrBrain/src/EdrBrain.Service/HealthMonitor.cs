using EdrBrain.Ingestion;
using EdrBrain.Storage;
using Microsoft.Extensions.Options;

namespace EdrBrain;

/// <summary>
/// Background health monitor that verifies the sensor is operating correctly.
/// Checks: collector health, database accessibility, memory usage, disk space.
/// Reports status to the Windows Service Control Manager.
/// </summary>
public sealed class HealthMonitor : BackgroundService
{
    private readonly ISysmonReader _reader;
    private readonly IStateManager _state;
    private readonly EdrOptions _options;
    private readonly ILogger<HealthMonitor> _logger;

    public HealthMonitor(
        ISysmonReader reader,
        IStateManager state,
        IOptions<EdrOptions> options,
        ILogger<HealthMonitor> logger)
    {
        _reader = reader;
        _state = state;
        _options = options.Value;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("HealthMonitor starting (interval={Interval}s)",
            _options.HealthCheckIntervalSeconds);

        while (!stoppingToken.IsCancellationRequested)
        {
            await Task.Delay(TimeSpan.FromSeconds(_options.HealthCheckIntervalSeconds), stoppingToken);

            try
            {
                var issues = new List<string>();

                // Check collector health
                if (!_reader.IsHealthy)
                    issues.Add("Sysmon collector is unhealthy");

                // Check database accessibility
                try
                {
                    var eventCount = _state.GetEventCount();
                    _logger.LogDebug("Health check: {EventCount} events in database", eventCount);
                }
                catch (Exception ex)
                {
                    issues.Add($"Database inaccessible: {ex.Message}");
                }

                // Check memory usage
                var currentProcess = System.Diagnostics.Process.GetCurrentProcess();
                var memoryMb = currentProcess.WorkingSet64 / (1024 * 1024);
                if (memoryMb > _options.MemoryCriticalMb)
                {
                    issues.Add($"Critical memory usage: {memoryMb}MB (limit: {_options.MemoryCriticalMb}MB)");
                }
                else if (memoryMb > _options.MemoryWarningMb)
                {
                    issues.Add($"High memory usage: {memoryMb}MB (warning: {_options.MemoryWarningMb}MB)");
                }

                // Check disk space
                var dbPath = _options.DatabasePath;
                var drive = Path.GetPathRoot(dbPath);
                if (!string.IsNullOrEmpty(drive))
                {
                    var driveInfo = new DriveInfo(drive);
                    var freeGb = driveInfo.AvailableFreeSpace / (1024 * 1024 * 1024);
                    if (freeGb < _options.DiskSpaceCriticalGb)
                    {
                        issues.Add($"Critical disk space: {freeGb}GB free on {drive}");
                    }
                    else if (freeGb < _options.DiskSpaceWarningGb)
                    {
                        issues.Add($"Low disk space: {freeGb}GB free on {drive}");
                    }
                }

                // Report status
                if (issues.Count > 0)
                {
                    _logger.LogWarning("Health issues detected: {Issues}", string.Join("; ", issues));
                }
                else
                {
                    _logger.LogDebug("Health check passed. Memory: {Mem}MB", memoryMb);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Health check failed with exception");
            }
        }
    }
}
