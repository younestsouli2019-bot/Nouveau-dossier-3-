namespace EdrBrain.Models;

/// <summary>
/// Configuration options for the EDR sensor, loaded from appsettings.json.
/// Supports hot-reload via IOptionsMonitor.
/// </summary>
public sealed class EdrOptions
{
    public const string SectionName = "Edr";

    // ── Collection ──────────────────────────────────────────────
    public string SysmonChannel { get; set; } = "Microsoft-Windows-Sysmon/Operational";
    public int[] MonitoredEventIds { get; set; } = { 1, 3, 5, 7, 8, 9, 10, 11, 13, 17, 18, 23 };
    public int ChannelCapacity { get; set; } = 10000;
    public int FallbackPollIntervalSeconds { get; set; } = 60;

    // ── Database ────────────────────────────────────────────────
    public string DatabasePath { get; set; } = @"C:\ProgramData\EdrBrain\edr.db";
    public int BatchInsertSize { get; set; } = 500;
    public int CacheSizeMb { get; set; } = 64;
    public int EventRetentionDays { get; set; } = 30;
    public int DiskSpaceWarningGb { get; set; } = 5;
    public int DiskSpaceCriticalGb { get; set; } = 1;

    // ── Graph Engine ────────────────────────────────────────────
    public int PruneIntervalMinutes { get; set; } = 5;
    public int TerminatedProcessRetentionMinutes { get; set; } = 30;
    public int MemoryWarningMb { get; set; } = 200;
    public int MemoryCriticalMb { get; set; } = 500;

    // ── Scoring ─────────────────────────────────────────────────
    public int AlertThreshold { get; set; } = 75;
    public int ChainLengthWeight { get; set; } = 15;
    public int EncodedCommandBonus { get; set; } = 30;
    public int UnsignedProcessBonus { get; set; } = 15;
    public int LolbinBonus { get; set; } = 25;
    public int NetworkC2Bonus { get; set; } = 20;
    public int RegistryPersistenceBonus { get; set; } = 20;

    // ── Response ────────────────────────────────────────────────
    public ResponsePolicy ResponsePolicy { get; set; } = ResponsePolicy.AlertOnly;
    public int ResponseCooldownSeconds { get; set; } = 300;

    // ── Detection Rules ─────────────────────────────────────────
    public string RulesPath { get; set; } = "Detection/rules";
    public int RuleReloadIntervalSeconds { get; set; } = 60;

    // ── SIEM Forwarding ─────────────────────────────────────────
    public bool EnableSiemForwarding { get; set; } = false;
    public string SiemEndpoint { get; set; } = string.Empty;
    public string SiemApiKey { get; set; } = string.Empty;

    // ── Health ──────────────────────────────────────────────────
    public int HealthCheckIntervalSeconds { get; set; } = 30;
}

public enum ResponsePolicy
{
    AlertOnly,         // Log + notify only
    Suspend,           // Suspend the root process
    KillProcessTree,   // Kill entire process tree
    Disabled,          // No automated response
}
