using EdrBrain.Engine;
using EdrBrain.Ingestion;
using EdrBrain.Models;
using EdrBrain.Response;
using EdrBrain.Storage;

namespace EdrBrain;

/// <summary>
/// Service host and dependency injection configuration for EdrBrain.
///
/// Architecture:
///   Three decoupled hosted services connected by Channels:
///   1. EventCollector    — reads Sysmon events → _eventChannel
///   2. Correlator        — reads from _eventChannel, runs graph + rules → _alertChannel
///   3. ResponseCoordinator — reads from _alertChannel, executes response
///
/// This decoupling ensures that a slow database write in the collector
/// does not block the correlation engine, and a failed response action
/// does not crash the collector.
/// </summary>
public class Program
{
    public static async Task Main(string[] args)
    {
        var builder = Host.CreateDefaultBuilder(args);

        builder.UseWindowsService(options =>
        {
            options.ServiceName = "EdrBrain";
        });

        builder.ConfigureServices((context, services) =>
        {
            // Configuration
            services.Configure<EdrOptions>(
                context.Configuration.GetSection(EdrOptions.SectionName));

            // Channels (connect the three hosted services)
            services.AddSingleton(_ =>
                System.Threading.Channels.Channel.CreateBounded<NormalizedEvent>(
                    new System.Threading.Channels.BoundedChannelOptions(50000)
                    {
                        FullMode = System.Threading.Channels.BoundedChannelFullMode.DropOldest,
                        SingleReader = true,
                        SingleWriter = true,
                    }));

            services.AddSingleton(_ =>
                System.Threading.Channels.Channel.CreateUnbounded<Alert>());

            // Storage
            services.AddSingleton<IStateManager, StateManager>();

            // Ingestion
            services.AddSingleton<EventParser>();
            services.AddSingleton<ISysmonReader, SysmonCollector>();

            // Engine
            services.AddSingleton<ScoreEngine>();
            services.AddSingleton<MitreMapper>();
            services.AddSingleton<SigmaRuleEngine>();
            services.AddSingleton<IGraphEngine, Engine.GraphEngine>();

            // Response
            services.AddSingleton<IAlertService, AlertService>();
            services.AddSingleton<IResponseEngine, ResponseEngine>();

            // Hosted services
            services.AddHostedService<EventCollector>();
            services.AddHostedService<Correlator>();
            services.AddHostedService<ResponseCoordinator>();

            // Health check
            services.AddHostedService<HealthMonitor>();
        });

        builder.ConfigureLogging(logging =>
        {
            logging.AddEventLog(settings =>
            {
                settings.SourceName = "EdrBrain";
                settings.LogName = "Application";
            });
            logging.AddConsole();
            logging.SetMinimumLevel(LogLevel.Information);
        });

        var host = builder.Build();

        // Initialize database schema before starting services
        var state = host.Services.GetRequiredService<IStateManager>();
        await state.InitializeSchemaAsync();

        // Load Sigma rules
        var ruleEngine = host.Services.GetRequiredService<SigmaRuleEngine>();
        ruleEngine.ReloadRules();

        await host.RunAsync();
    }
}
