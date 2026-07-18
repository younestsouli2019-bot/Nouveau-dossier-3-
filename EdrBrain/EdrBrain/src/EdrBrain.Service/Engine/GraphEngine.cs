using System.Collections.Concurrent;
using EdrBrain.Models;
using EdrBrain.Storage;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace EdrBrain.Engine;

/// <summary>
/// In-memory attack graph engine with incremental analysis and persistence.
///
/// Architecture:
///   - ConcurrentDictionary for thread-safe node/edge storage
///   - Incremental subgraph analysis (not full-scan) on each new ProcessCreate
///   - Periodic full-scan as a safety net
///   - Graph pruning based on process termination events
///   - Persistent to SQLite on schedule and on shutdown
///
/// The LOLBin list and suspicious-root heuristics are configurable via EdrOptions.
/// </summary>
public sealed class GraphEngine : IGraphEngine
{
    private readonly ILogger<GraphEngine> _logger;
    private readonly EdrOptions _options;
    private readonly IStateManager _state;
    private readonly ScoreEngine _scorer;
    private readonly MitreMapper _mitre;

    private readonly ConcurrentDictionary<int, ProcessNode> _nodes = new();
    private readonly ConcurrentDictionary<int, List<int>> _edges = new(); // parent → children

    // Known LOLBins and suspicious parent processes (configurable)
    private static readonly HashSet<string> SuspiciousRootNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "java.exe", "javaw.exe", "wscript.exe", "cscript.exe",
        "mshta.exe", "powershell.exe", "cmd.exe",
        "rundll32.exe", "certutil.exe", "bitsadmin.exe",
        "wmic.exe", "msiexec.exe",
    };

    private static readonly HashSet<string> LolbinNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "mshta.exe", "certutil.exe", "bitsadmin.exe",
        "rundll32.exe", "wmic.exe", "installutil.exe",
        "regsvr32.exe", "msiexec.exe", "cmstp.exe",
        "ieexec.exe", "msbuild.exe", "cscript.exe",
        "wscript.exe", "control.exe", "bash.exe",
    };

    public int ActiveNodeCount => _nodes.Count;

    public GraphEngine(
        ILogger<GraphEngine> logger,
        IOptions<EdrOptions> options,
        IStateManager state,
        ScoreEngine scorer,
        MitreMapper mitre)
    {
        _logger = logger;
        _options = options.Value;
        _state = state;
        _scorer = scorer;
        _mitre = mitre;
    }

    // ── Graph Mutation ─────────────────────────────────────────

    public void AddEvent(NormalizedEvent evt)
    {
        if (evt.ActionType == SysmonAction.ProcessTerminate)
        {
            MarkTerminated(evt.ProcessId);
            return;
        }

        if (evt.ActionType != SysmonAction.ProcessCreate)
            return;

        var node = new ProcessNode
        {
            Pid = evt.ProcessId,
            Name = Path.GetFileName(evt.ProcessName),
            CommandLine = evt.CommandLine,
            Hash = evt.ProcessHash,
            Signature = evt.Signature,
            ParentPid = evt.ParentProcessId,
            ParentName = evt.ParentProcessName,
            StartTime = evt.Timestamp,
            IsSuspiciousRoot = IsSuspiciousRoot(evt),
        };

        _nodes[evt.ProcessId] = node;

        if (evt.ParentProcessId.HasValue)
        {
            _edges.AddOrUpdate(
                evt.ParentProcessId.Value,
                _ => new List<int> { evt.ProcessId },
                (_, children) => { children.Add(evt.ProcessId); return children; });
        }
    }

    public void MarkTerminated(int pid)
    {
        if (_nodes.TryGetValue(pid, out var node))
        {
            node.EndTime = DateTime.UtcNow;
        }
    }

    // ── Analysis ───────────────────────────────────────────────

    public List<AttackChain> AnalyzeSubgraph(int rootPid)
    {
        var chains = new List<AttackChain>();

        // Walk up to find the true root of this process tree
        var trueRoot = FindRootPid(rootPid);

        if (!_nodes.TryGetValue(trueRoot, out var rootNode))
            return chains;

        if (!rootNode.IsSuspiciousRoot)
            return chains;

        var members = BuildChain(trueRoot);
        if (members.Count < 2)
            return chains;

        var chain = new AttackChain
        {
            RootPid = trueRoot,
            Members = members,
        };

        chain.Score = _scorer.ScoreChain(members);
        var (tactics, techniques) = _mitre.MapChain(members);
        chain.Tactics = tactics;
        chain.Techniques = techniques;

        chains.Add(chain);
        return chains;
    }

    public List<AttackChain> FindAllAttackChains()
    {
        var chains = new List<AttackChain>();

        foreach (var (pid, node) in _nodes)
        {
            if (!node.IsSuspiciousRoot)
                continue;

            var members = BuildChain(pid);
            if (members.Count < 2)
                continue;

            var chain = new AttackChain
            {
                RootPid = pid,
                Members = members,
            };

            chain.Score = _scorer.ScoreChain(members);
            var (tactics, techniques) = _mitre.MapChain(members);
            chain.Tactics = tactics;
            chain.Techniques = techniques;

            chains.Add(chain);
        }

        return chains;
    }

    // ── Pruning ────────────────────────────────────────────────

    public int PruneStaleNodes(TimeSpan retentionWindow)
    {
        var toRemove = _nodes
            .Where(kvp => kvp.Value.IsEligibleForPruning(retentionWindow))
            .Select(kvp => kvp.Key)
            .ToList();

        foreach (var pid in toRemove)
        {
            _nodes.TryRemove(pid, out _);
            _edges.TryRemove(pid, out _);

            // Remove this PID from parent's edge list
            foreach (var edgeList in _edges.Values)
                edgeList.Remove(pid);
        }

        if (toRemove.Count > 0)
        {
            _logger.LogInformation("Pruned {Count} stale graph nodes (retention={Retention}min)",
                toRemove.Count, retentionWindow.TotalMinutes);
        }

        return toRemove.Count;
    }

    // ── Persistence ────────────────────────────────────────────

    public async Task PersistAsync(CancellationToken ct = default)
    {
        await _state.SaveGraphNodesAsync(_nodes.Values, ct);
        _logger.LogDebug("Persisted {Count} graph nodes to database", _nodes.Count);
    }

    public void LoadFromStorage()
    {
        var nodes = _state.LoadActiveNodes();
        int count = 0;
        foreach (var node in nodes)
        {
            _nodes[node.Pid] = node;
            if (node.ParentPid.HasValue)
            {
                _edges.AddOrUpdate(
                    node.ParentPid.Value,
                    _ => new List<int> { node.Pid },
                    (_, children) => { children.Add(node.Pid); return children; });
            }
            count++;
        }
        _logger.LogInformation("Loaded {Count} active nodes from storage", count);
    }

    // ── Private Helpers ────────────────────────────────────────

    private bool IsSuspiciousRoot(NormalizedEvent evt)
    {
        var name = Path.GetFileName(evt.ProcessName);

        // Name-based check
        if (SuspiciousRootNames.Contains(name))
            return true;

        // Unsigned process spawning children
        if (evt.Signature == SignatureStatus.Invalid)
            return true;

        // Encoded PowerShell commands
        if (evt.CommandLine.Contains("-enc", StringComparison.OrdinalIgnoreCase) ||
            evt.CommandLine.Contains("-EncodedCommand", StringComparison.OrdinalIgnoreCase))
            return true;

        // Process running from temp/user-writeable directories
        var lowerPath = evt.ProcessName.ToLowerInvariant();
        if (lowerPath.Contains(@"\appdata\local\temp\") ||
            lowerPath.Contains(@"\users\public\") ||
            lowerPath.Contains(@"\programdata\") && !evt.Signature.HasFlag(SignatureStatus.Signed))
            return true;

        return false;
    }

    private int FindRootPid(int pid)
    {
        var visited = new HashSet<int>();
        var current = pid;

        while (_nodes.TryGetValue(current, out var node) && node.ParentPid.HasValue)
        {
            if (visited.Contains(current))
                break; // Cycle detected
            visited.Add(current);

            if (!_nodes.ContainsKey(node.ParentPid.Value))
                break; // Parent not in graph

            current = node.ParentPid.Value;
        }

        return current;
    }

    private List<ProcessNode> BuildChain(int rootPid)
    {
        var chain = new List<ProcessNode>();
        var queue = new Queue<int>();
        queue.Enqueue(rootPid);

        while (queue.Count > 0)
        {
            var current = queue.Dequeue();
            if (!_nodes.TryGetValue(current, out var node))
                continue;
            if (chain.Any(n => n.Pid == current))
                continue; // Prevent cycles

            chain.Add(node);

            if (_edges.TryGetValue(current, out var children))
            {
                foreach (var child in children)
                    queue.Enqueue(child);
            }
        }

        return chain;
    }
}
