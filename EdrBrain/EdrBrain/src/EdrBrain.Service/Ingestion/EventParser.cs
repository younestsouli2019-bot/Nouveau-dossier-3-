using System.Diagnostics.Eventing.Reader;
using System.Xml.Linq;
using EdrBrain.Models;

namespace EdrBrain.Ingestion;

/// <summary>
/// Parses raw Sysmon EventRecord objects into NormalizedEvent instances.
/// Uses forward-only XmlReader for performance on high-volume endpoints.
///
/// Sysmon EventData uses a flat key=value XML structure:
///   &lt;EventData&gt;
///     &lt;Data Name="Image"&gt;C:\Windows\...&lt;/Data&gt;
///     &lt;Data Name="CommandLine"&gt;...&lt;/Data&gt;
///   &lt;/EventData&gt;
///
/// Each EventID has its own schema. This parser maps each supported EventID
/// to the appropriate fields in NormalizedEvent.
/// </summary>
public sealed class EventParser
{
    /// <summary>
    /// Parse a Sysmon EventRecord into a NormalizedEvent.
    /// Returns null if the event type is not supported or parsing fails.
    /// </summary>
    public NormalizedEvent? ParseEvent(EventRecord record)
    {
        try
        {
            var xml = record.ToXml();
            var doc = XDocument.Parse(xml);
            var eventData = doc.Descendants("Data")
                .Where(d => d.Attribute("Name") != null)
                .ToDictionary(
                    d => d.Attribute("Name")!.Value,
                    d => d.Value,
                    StringComparer.OrdinalIgnoreCase);

            var timestamp = record.TimeCreated ?? DateTime.UtcNow;
            var eventUid = $"{record.RecordId}:{timestamp:O}";

            return record.Id switch
            {
                1  => ParseProcessCreate(eventUid, timestamp, eventData, record, xml),
                3  => ParseNetworkConnect(eventUid, timestamp, eventData, record, xml),
                5  => ParseProcessTerminate(eventUid, timestamp, eventData, record, xml),
                7  => ParseImageLoaded(eventUid, timestamp, eventData, record, xml),
                8  => ParseCreateRemoteThread(eventUid, timestamp, eventData, record, xml),
                9  => ParseRawAccessRead(eventUid, timestamp, eventData, record, xml),
                10 => ParseProcessAccess(eventUid, timestamp, eventData, record, xml),
                11 => ParseFileCreate(eventUid, timestamp, eventData, record, xml),
                13 => ParseRegistrySetValue(eventUid, timestamp, eventData, record, xml),
                17 => ParsePipeEvent(eventUid, timestamp, eventData, record, xml),
                18 => ParsePipeConnected(eventUid, timestamp, eventData, record, xml),
                23 => ParseFileDelete(eventUid, timestamp, eventData, record, xml),
                _  => null
            };
        }
        catch
        {
            return null;
        }
    }

    // ── Per-EventID Parsers ────────────────────────────────────

    private NormalizedEvent ParseProcessCreate(string uid, DateTime ts,
        Dictionary<string, string> d, EventRecord r, string xml) => new()
    {
        EventUid = uid,
        Timestamp = ts,
        ActionType = SysmonAction.ProcessCreate,
        ProcessName = GetValue(d, "Image"),
        ProcessId = GetInt(d, "ProcessId"),
        CommandLine = GetValue(d, "CommandLine"),
        ProcessHash = ExtractSha256(GetValue(d, "Hashes")),
        Signature = ParseSignature(GetValue(d, "Signed")),
        ParentProcessId = GetIntOrNull(d, "ParentProcessId"),
        ParentProcessName = GetValue(d, "ParentImage"),
        ParentCommandLine = GetValue(d, "ParentCommandLine"),
        UserSid = GetValue(d, "UserSid"),
        UserName = GetValue(d, "User"),
        Target = string.Empty,
        RawXml = xml,
    };

    private NormalizedEvent ParseNetworkConnect(string uid, DateTime ts,
        Dictionary<string, string> d, EventRecord r, string xml) => new()
    {
        EventUid = uid,
        Timestamp = ts,
        ActionType = SysmonAction.NetworkConnect,
        ProcessName = GetValue(d, "Image"),
        ProcessId = GetInt(d, "ProcessId"),
        CommandLine = GetValue(d, "CommandLine"),
        ProcessHash = ExtractSha256(GetValue(d, "Hashes")),
        ParentProcessId = GetIntOrNull(d, "ParentProcessId"),
        Target = $"{GetValue(d, "DestinationIp")}:{GetValue(d, "DestinationPort")}",
        UserName = GetValue(d, "User"),
        RawXml = xml,
    };

    private NormalizedEvent ParseProcessTerminate(string uid, DateTime ts,
        Dictionary<string, string> d, EventRecord r, string xml) => new()
    {
        EventUid = uid,
        Timestamp = ts,
        ActionType = SysmonAction.ProcessTerminate,
        ProcessName = GetValue(d, "Image"),
        ProcessId = GetInt(d, "ProcessId"),
        RawXml = xml,
    };

    private NormalizedEvent ParseImageLoaded(string uid, DateTime ts,
        Dictionary<string, string> d, EventRecord r, string xml) => new()
    {
        EventUid = uid,
        Timestamp = ts,
        ActionType = SysmonAction.ImageLoaded,
        ProcessName = GetValue(d, "Image"),
        ProcessId = GetInt(d, "ProcessId"),
        Target = GetValue(d, "ImageLoaded"),
        ProcessHash = ExtractSha256(GetValue(d, "Hashes")),
        Signature = ParseSignature(GetValue(d, "Signed")),
        RawXml = xml,
    };

    private NormalizedEvent ParseCreateRemoteThread(string uid, DateTime ts,
        Dictionary<string, string> d, EventRecord r, string xml) => new()
    {
        EventUid = uid,
        Timestamp = ts,
        ActionType = SysmonAction.CreateRemoteThread,
        ProcessName = GetValue(d, "SourceImage"),
        ProcessId = GetInt(d, "SourceProcessId"),
        ParentProcessId = GetIntOrNull(d, "SourceProcessId"),
        Target = GetValue(d, "TargetImage"),
        RawXml = xml,
    };

    private NormalizedEvent ParseRawAccessRead(string uid, DateTime ts,
        Dictionary<string, string> d, EventRecord r, string xml) => new()
    {
        EventUid = uid,
        Timestamp = ts,
        ActionType = SysmonAction.RawAccessRead,
        ProcessName = GetValue(d, "Image"),
        ProcessId = GetInt(d, "ProcessId"),
        Target = GetValue(d, "Device"),
        RawXml = xml,
    };

    private NormalizedEvent ParseProcessAccess(string uid, DateTime ts,
        Dictionary<string, string> d, EventRecord r, string xml) => new()
    {
        EventUid = uid,
        Timestamp = ts,
        ActionType = SysmonAction.ProcessAccess,
        ProcessName = GetValue(d, "SourceImage"),
        ProcessId = GetInt(d, "SourceProcessId"),
        Target = $"{GetValue(d, "TargetImage")}|GrantedAccess={GetValue(d, "GrantedAccess")}",
        RawXml = xml,
    };

    private NormalizedEvent ParseFileCreate(string uid, DateTime ts,
        Dictionary<string, string> d, EventRecord r, string xml) => new()
    {
        EventUid = uid,
        Timestamp = ts,
        ActionType = SysmonAction.FileCreate,
        ProcessName = GetValue(d, "Image"),
        ProcessId = GetInt(d, "ProcessId"),
        Target = GetValue(d, "TargetFilename"),
        RawXml = xml,
    };

    private NormalizedEvent ParseRegistrySetValue(string uid, DateTime ts,
        Dictionary<string, string> d, EventRecord r, string xml) => new()
    {
        EventUid = uid,
        Timestamp = ts,
        ActionType = SysmonAction.RegistrySetValue,
        ProcessName = GetValue(d, "Image"),
        ProcessId = GetInt(d, "ProcessId"),
        Target = GetValue(d, "TargetObject"),
        RawXml = xml,
    };

    private NormalizedEvent ParsePipeEvent(string uid, DateTime ts,
        Dictionary<string, string> d, EventRecord r, string xml) => new()
    {
        EventUid = uid,
        Timestamp = ts,
        ActionType = SysmonAction.PipeEvent,
        ProcessName = GetValue(d, "Image"),
        ProcessId = GetInt(d, "ProcessId"),
        Target = GetValue(d, "PipeName"),
        RawXml = xml,
    };

    private NormalizedEvent ParsePipeConnected(string uid, DateTime ts,
        Dictionary<string, string> d, EventRecord r, string xml) => new()
    {
        EventUid = uid,
        Timestamp = ts,
        ActionType = SysmonAction.PipeConnected,
        ProcessName = GetValue(d, "Image"),
        ProcessId = GetInt(d, "ProcessId"),
        Target = GetValue(d, "PipeName"),
        RawXml = xml,
    };

    private NormalizedEvent ParseFileDelete(string uid, DateTime ts,
        Dictionary<string, string> d, EventRecord r, string xml) => new()
    {
        EventUid = uid,
        Timestamp = ts,
        ActionType = SysmonAction.FileDelete,
        ProcessName = GetValue(d, "Image"),
        ProcessId = GetInt(d, "ProcessId"),
        Target = GetValue(d, "TargetFilename"),
        RawXml = xml,
    };

    // ── Helpers ────────────────────────────────────────────────

    private static string GetValue(Dictionary<string, string> d, string key) =>
        d.TryGetValue(key, out var val) ? val : string.Empty;

    private static int GetInt(Dictionary<string, string> d, string key) =>
        d.TryGetValue(key, out var val) && int.TryParse(val, out var i) ? i : 0;

    private static int? GetIntOrNull(Dictionary<string, string> d, string key) =>
        d.TryGetValue(key, out var val) && int.TryParse(val, out var i) ? i : null;

    private static string ExtractSha256(string hashes) =>
        hashes.Split(',', StringSplitOptions.RemoveEmptyEntries)
              .FirstOrDefault(h => h.TrimStart().StartsWith("SHA256=", StringComparison.OrdinalIgnoreCase))
              ?.Replace("SHA256=", "", StringComparison.OrdinalIgnoreCase).Trim()
              ?? string.Empty;

    private static SignatureStatus ParseSignature(string signed) =>
        signed.Trim().ToUpperInvariant() switch
        {
            "TRUE" or "IS SIGNED" or "VALID" => SignatureStatus.Signed,
            "FALSE" or "NOT SIGNED" or "INVALID" => SignatureStatus.Invalid,
            _ => SignatureStatus.Unknown,
        };
}
