/**
 * rail-registry — resilient multi-rail settlement layer.
 *
 * The "Resilient Architecture" blueprint (2026-09-08), implemented UNDER the
 * Constitution v2 settlement rules instead of against them:
 *
 *   ✔ Multi-rail failover (Attijariwafa wire first, then Wise/Stripe/Payoneer)
 *   ✔ DeFi rails REGISTERED as future fallbacks (Vultisig/Tegro/gasless)
 *   ✘ NEVER simulated success: a rail that has not been wired throws
 *     RailNotImplementedError (fail-closed) — it does not fabricate a
 *     SUCCESS_* artifact. Invariant I6 bans that pattern repo-wide.
 *   ✘ NEVER failover on UNKNOWN: an unclassifiable error (timeout, network
 *     fault, partial submit) means the payout's true state is unknown — it
 *     is quarantined for reconciliation. Blind rail-pivoting on an unknown
 *     state is how double settlements happen.
 *   ✘ NEVER overwrite execution code at runtime: "self-healing" applies to
 *     concurrency lint (see devops-self-healing), not to the money path.
 *     The repairman's vocabulary is provably limited to concurrency lines.
 *
 * Failover semantics (reconciliation-first):
 *   SUBMITTED                  -> done, evidence recorded
 *   REJECTED                   -> KNOWN-FAILED  -> failover to next rail allowed
 *   LivePathUnavailableError   -> KNOWN-UNAVAILABLE -> failover allowed
 *   RailNotImplementedError    -> KNOWN-STUB -> failover allowed (fenced)
 *   anything else              -> UNKNOWN -> QUARANTINE (no retry, no pivot)
 */

import type {
  DestinationType,
  PayoutProvider,
  ProviderSubmission,
  ProviderSubmissionResult,
  ProviderStatusResult,
} from './provider';
import { LivePathUnavailableError } from './provider';

/** A registered rail that has no live implementation yet — fail-closed. */
export class RailNotImplementedError extends Error {
  constructor(public readonly rail: string) {
    super(
      `[fail-closed] rail '${rail}' is registered as a future fallback but has no live wiring. ` +
        'It must NEVER be simulated: no SUCCESS_* artifacts, no fabricated providerTransactionId.'
    );
    this.name = 'RailNotImplementedError';
  }
}

/** Primary state became unclassifiable — reconciliation is mandatory. */
export class RailQuarantinedError extends Error {
  constructor(public readonly rail: string, public readonly attempts: unknown) {
    super(
      `[quarantined] rail '${rail}' returned an UNKNOWN outcome. No retry, no rail pivot, ` +
        'until provider reconciliation determines the true state. Attempts: ' +
        JSON.stringify(attempts)
    );
    this.name = 'RailQuarantinedError';
  }
}

/** Every rail refused or was unavailable — payout needs operator/owner input. */
export class RailsExhaustedError extends Error {
  constructor(public readonly attempts: unknown) {
    super(
      '[exhausted] all rails in the priority chain refused or were unavailable (all KNOWN states). ' +
        'Payout remains RESERVED; see attempts: ' + JSON.stringify(attempts)
    );
    this.name = 'RailsExhaustedError';
  }
}

/**
 * Rail priority per destination type. Attijariwafa bank wire is the primary
 * rail for Morocco-local settlements by standing instruction, then Wise,
 * Stripe, Payoneer. DeFi rails are future fallbacks, registered as stubs.
 */
export const RAIL_PRIORITY: Record<DestinationType, readonly string[]> = {
  bank: ['attijariwafa-wire', 'wise', 'stripe', 'payoneer'],
  paypal: ['paypal'],
  crypto: ['crypto-direct', 'vultisig-defi', 'tegro-defi'], // Vultisig/Tegro = fenced P3 rails
};

/** Returns the provider for a rail name, or null when the rail is absent. */
export type RailRegistry = (rail: string) => PayoutProvider | null;

export type RailOutcome = 'SUBMITTED' | 'REJECTED' | 'RAIL_UNAVAILABLE' | 'NOT_IMPLEMENTED' | 'UNKNOWN';

export interface RailAttempt {
  rail: string;
  outcome: RailOutcome;
  providerRequestId?: string;
  reason?: string;
}

export type SettlementDecision =
  | { kind: 'SUBMITTED'; rail: string; result: ProviderSubmissionResult; attempts: RailAttempt[] }
  | { kind: 'QUARANTINED'; rail: string; attempts: RailAttempt[] }
  | { kind: 'EXHAUSTED'; attempts: RailAttempt[] };

/**
 * Attempt settlement across the priority chain with reconciliation-first
 * failover. One pass per call — retries are the caller's explicit,
 * reconciliation-informed decision, never an implicit loop.
 */
export async function attemptSettlement(
  destinationType: DestinationType,
  registry: RailRegistry,
  submission: ProviderSubmission
): Promise<SettlementDecision> {
  const attempts: RailAttempt[] = [];
  for (const rail of RAIL_PRIORITY[destinationType]) {
    const provider = registry(rail);
    if (!provider) {
      attempts.push({ rail, outcome: 'RAIL_UNAVAILABLE', reason: 'not registered' });
      continue;
    }
    try {
      const result = await provider.submit(submission);
      if (result.status === 'SUBMITTED') {
        attempts.push({ rail, outcome: 'SUBMITTED', providerRequestId: result.providerRequestId });
        return { kind: 'SUBMITTED', rail, result, attempts };
      }
      // REJECTED is a KNOWN terminal state on this rail — failover allowed.
      attempts.push({ rail, outcome: 'REJECTED', reason: 'rail rejected the instruction' });
      continue;
    } catch (err) {
      if (err instanceof LivePathUnavailableError) {
        attempts.push({ rail, outcome: 'RAIL_UNAVAILABLE', reason: err.reason });
        continue; // fail-closed = KNOWN unavailable, pivot allowed
      }
      if (err instanceof RailNotImplementedError) {
        attempts.push({ rail, outcome: 'NOT_IMPLEMENTED', reason: 'fenced stub rail' });
        continue; // KNOWN stub, pivot allowed
      }
      // UNKNOWN: timeout, network fault, partial submit, anything unclassifiable.
      // NEVER pivot or retry blind — quarantine for reconciliation.
      attempts.push({
        rail,
        outcome: 'UNKNOWN',
        reason: err instanceof Error ? err.message : String(err),
      });
      return { kind: 'QUARANTINED', rail, attempts };
    }
  }
  return { kind: 'EXHAUSTED', attempts };
}

const RAIL_ID_PREFIX = /^([a-z0-9-]+)::(.+)$/;

/**
 * Drop-in PayoutProvider that walks the rail chain. Fits the existing
 * pipeline seam unchanged: providers(destinationType) -> RailFallbackProvider.
 * providerRequestId is namespaced `rail::id` so fetchStatus can route back
 * to the owning rail for evidence-based reconciliation.
 */
export class RailFallbackProvider implements PayoutProvider {
  readonly name = 'rail-fallback';

  constructor(
    readonly destinationType: DestinationType,
    private readonly registry: RailRegistry
  ) {}

  async submit(submission: ProviderSubmission): Promise<ProviderSubmissionResult> {
    const decision = await attemptSettlement(this.destinationType, this.registry, submission);
    if (decision.kind === 'SUBMITTED') {
      return {
        ...decision.result,
        providerRequestId: `${decision.rail}::${decision.result.providerRequestId}`,
        evidence: {
          ...decision.result.evidence,
          rail: decision.rail,
          railAttempts: decision.attempts,
        },
      };
    }
    if (decision.kind === 'QUARANTINED') {
      throw new RailQuarantinedError(decision.rail, decision.attempts);
    }
    throw new RailsExhaustedError(decision.attempts);
  }

  async fetchStatus(providerRequestId: string): Promise<ProviderStatusResult> {
    const m = providerRequestId.match(RAIL_ID_PREFIX);
    if (!m) {
      // Not rail-namespaced — never guess. Unknown stays unknown.
      return { status: 'UNKNOWN', evidence: { providerRequestId, note: 'unroutable request id' } };
    }
    const [, rail, innerId] = m;
    const provider = this.registry(rail);
    if (!provider) {
      return { status: 'UNKNOWN', evidence: { providerRequestId, note: `rail '${rail}' no longer registered` } };
    }
    return provider.fetchStatus(innerId);
  }
}

/**
 * A fenced future rail (Vultisig / Tegro / gasless-relayer patterns). The
 * registration makes the rail VISIBLE in the priority chain — visibility
 * without the ability to fabricate success.
 */
export class FencedRailProvider implements PayoutProvider {
  readonly destinationType: DestinationType;
  constructor(readonly name: string, destinationType: DestinationType) {
    this.destinationType = destinationType;
  }
  async submit(): Promise<ProviderSubmissionResult> {
    throw new RailNotImplementedError(this.name);
  }
  async fetchStatus(): Promise<ProviderStatusResult> {
    throw new RailNotImplementedError(this.name);
  }
}
