using EdrBrain.Models;
using Microsoft.Extensions.Options;

namespace EdrBrain.Engine;

/// <summary>
/// Multi-signal weighted scoring engine for attack chains.
/// Replaces the simplistic (chainLength * 20 + 40) formula with
/// a configurable weighted scoring model that considers:
///   - Chain length
///   - Encoded commands
///   - Unsigned binaries
///   - LOLBin usage
///   - Network C2 indicators
///   - Registry persistence indicators
///
/// All weights are configurable via EdrOptions for hot-reload tuning.
/// </summary>
public sealed class ScoreEngine
{
    private readonly EdrOptions _options;

    public ScoreEngine(IOptions<EdrOptions> options)
    {
        _options = options.Value;
    }

    /// <summary>
    /// Score an attack chain based on multiple behavioral signals.
    /// Returns a score from 0-200+ (threshold is configurable, default 75).
    /// </summary>
    public int ScoreChain(List<ProcessNode> chain)
    {
        int score = 0;

        // Chain length component (diminishing returns)
        score += Math.Min(chain.Count * _options.ChainLengthWeight, 60);

        // Per-node behavioral signals
        foreach (var node in chain)
        {
            // Encoded command bonus
            if (node.CommandLine.Contains("-enc", StringComparison.OrdinalIgnoreCase) ||
                node.CommandLine.Contains("-EncodedCommand", StringComparison.OrdinalIgnoreCase))
            {
                score += _options.EncodedCommandBonus;
            }

            // Unsigned binary bonus
            if (node.Signature == SignatureStatus.Invalid ||
                node.Signature == SignatureStatus.Unknown && !string.IsNullOrEmpty(node.Hash))
            {
                score += _options.UnsignedProcessBonus;
            }

            // LOLBin usage bonus
            if (IsLolbin(node.Name))
            {
                score += _options.LolbinBonus;
            }

            // Running from suspicious paths
            var lower = node.CommandLine.ToLowerInvariant();
            if (lower.Contains(@"\appdata\local\temp\") ||
                lower.Contains(@"\users\public\") ||
                lower.Contains(@"\programdata\"))
            {
                score += 10;
            }
        }

        // Cross-node correlation bonuses
        // Network + LOLBin = strong C2 indicator
        if (chain.Any(n => IsLolbin(n.Name)) && HasNetworkEvent(chain))
        {
            score += _options.NetworkC2Bonus;
        }

        // Registry + execution = persistence indicator
        if (HasRegistryPersistence(chain))
        {
            score += _options.RegistryPersistenceBonus;
        }

        // Process injection pattern: remote thread creation
        if (chain.Any(n => n.CommandLine.Contains("CreateRemoteThread", StringComparison.OrdinalIgnoreCase)) ||
            chain.Any(n => n.Name.Equals("svchost.exe", StringComparison.OrdinalIgnoreCase) &&
                           n.CommandLine.Length == 0))
        {
            score += 25;
        }

        return score;
    }

    private static bool IsLolbin(string name) =>
        GraphEngine.LolbinNames.Contains(name); // Access the static set

    private static bool HasNetworkEvent(List<ProcessNode> chain) =>
        chain.Any(n => n.CommandLine.Contains("http://", StringComparison.OrdinalIgnoreCase) ||
                       n.CommandLine.Contains("https://", StringComparison.OrdinalIgnoreCase));

    private static bool HasRegistryPersistence(List<ProcessNode> chain) =>
        chain.Any(n =>
            n.CommandLine.Contains(@"\Run\", StringComparison.OrdinalIgnoreCase) ||
            n.CommandLine.Contains(@"\RunOnce\", StringComparison.OrdinalIgnoreCase) ||
            n.CommandLine.Contains("CurrentVersion\\Run", StringComparison.OrdinalIgnoreCase));
}
