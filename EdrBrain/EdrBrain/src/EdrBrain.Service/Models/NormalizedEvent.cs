namespace EdrBrain.Models;

/// <summary>
/// Unified event model produced by the Sysmon ingestion pipeline.
/// Every Sysmon event type is normalized into this shape for downstream
/// correlation, storage, and detection.
/// </summary>
public sealed class NormalizedEvent
{
    public long Id { get; set; }
    public string EventUid { get; set; } = string.Empty;
    public DateTime Timestamp { get; set; }
    public string Host { get; set; } = Environment.MachineName;
    public string UserSid { get; set; } = string.Empty;
    public string UserName { get; set; } = string.Empty;
    public string ProcessName { get; set; } = string.Empty;
    public int ProcessId { get; set; }
    public string CommandLine { get; set; } = string.Empty;
    public string ProcessHash { get; set; } = string.Empty;
    public SignatureStatus Signature { get; set; } = SignatureStatus.Unknown;
    public int? ParentProcessId { get; set; }
    public string ParentProcessName { get; set; } = string.Empty;
    public string ParentCommandLine { get; set; } = string.Empty;
    public SysmonAction ActionType { get; set; }
    public string Target { get; set; } = string.Empty;
    public string RawXml { get; set; } = string.Empty;
}

public enum SysmonAction
{
    ProcessCreate,      // EID 1
    NetworkConnect,     // EID 3
    ProcessTerminate,   // EID 5
    ImageLoaded,        // EID 7
    CreateRemoteThread, // EID 8
    RawAccessRead,      // EID 9
    ProcessAccess,      // EID 10
    FileCreate,         // EID 11
    RegistrySetValue,   // EID 13
    PipeEvent,          // EID 17
    PipeConnected,      // EID 18
    FileDelete,         // EID 23
}

public enum SignatureStatus
{
    Unknown = 0,
    Signed  = 1,
    Invalid = -1,
}
