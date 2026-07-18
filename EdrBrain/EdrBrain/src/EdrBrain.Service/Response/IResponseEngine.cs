using EdrBrain.Models;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace EdrBrain.Response;

/// <summary>
/// Interface for the response engine.
/// </summary>
public interface IResponseEngine
{
    /// <summary>
    /// Execute the configured response policy on an attack chain.
    /// Returns the action taken.
    /// </summary>
    Task<string> RespondAsync(AttackChain chain, CancellationToken ct = default);
}
