import { describe, expect, it } from 'vitest';
import type { DestinationType, PayoutProvider, ProviderSubmission, ProviderSubmissionResult, ProviderStatusResult } from '../provider';
import { LivePathUnavailableError } from '../provider';
import {
  attemptSettlement,
  FencedRailProvider,
  RailFallbackProvider,
  RailNotImplementedError,
  RAIL_PRIORITY,
} from '../rail-registry';

/** Programmable provider for scenario tests. */
function makeProvider(
  name: string,
  destinationType: DestinationType,
  behavior: 'submit' | 'reject' | 'unavailable' | 'explode' | 'not-implemented',
  submitResult?: Partial<ProviderSubmissionResult>
): PayoutProvider {
  return {
    name,
    destinationType,
    async submit(_s: ProviderSubmission): Promise<ProviderSubmissionResult> {
      if (behavior === 'reject') return { providerRequestId: 'x', status: 'REJECTED', submittedAt: new Date().toISOString(), evidence: {} };
      if (behavior === 'unavailable') throw new LivePathUnavailableError(name, 'not configured');
      if (behavior === 'explode') throw new Error('ETIMEDOUT after partial submit');
      if (behavior === 'not-implemented') throw new RailNotImplementedError(name);
      return {
        providerRequestId: `req-${name}`,
        status: 'SUBMITTED',
        submittedAt: new Date().toISOString(),
        evidence: { rail: name, ...(submitResult?.evidence ?? {}) },
      };
    },
    async fetchStatus(_id: string): Promise<ProviderStatusResult> {
      return { status: 'UNKNOWN', evidence: {} };
    },
  };
}

const sub = (destinationType: DestinationType): ProviderSubmission => ({
  payoutId: 'po_1',
  idempotencyKey: 'idem-1',
  currency: 'USD',
  netAmount: 25,
  destinationType,
  destinationFingerprint: 'a'.repeat(64),
});

describe('rail priority (standing instruction)', () => {
  it('orders bank rails Attijariwafa-first, then Wise, Stripe, Payoneer', () => {
    expect(RAIL_PRIORITY.bank).toEqual(['attijariwafa-wire', 'wise', 'stripe', 'payoneer']);
  });
});

describe('reconciliation-first failover', () => {
  it('pivots to the next rail on a KNOWN REJECTED state', async () => {
    const order: string[] = [];
    const registry = (rail: string) => {
      order.push(rail);
      if (rail === 'attijariwafa-wire') return makeProvider(rail, 'bank', 'reject');
      return makeProvider(rail, 'bank', 'submit');
    };
    const d = await attemptSettlement('bank', registry, sub('bank'));
    expect(d.kind).toBe('SUBMITTED');
    if (d.kind !== 'SUBMITTED') return;
    expect(d.rail).toBe('wise');
    expect(order[0]).toBe('attijariwafa-wire'); // priority respected
    expect(d.attempts.map((a) => a.outcome)).toEqual(['REJECTED', 'SUBMITTED']);
  });

  it('NEVER pivots on UNKNOWN — the payout is quarantined instead', async () => {
    let secondaryCalled = false;
    const registry = (rail: string) => {
      if (rail === 'attijariwafa-wire') return makeProvider(rail, 'bank', 'explode');
      secondaryCalled = true;
      return makeProvider(rail, 'bank', 'submit');
    };
    const d = await attemptSettlement('bank', registry, sub('bank'));
    expect(d.kind).toBe('QUARANTINED');
    expect(secondaryCalled).toBe(false); // no blind retry, no pivot
  });

  it('pivots on LivePathUnavailableError (known-unavailable)', async () => {
    const registry = (rail: string) =>
      rail === 'attijariwafa-wire'
        ? makeProvider(rail, 'bank', 'unavailable')
        : makeProvider(rail, 'bank', 'submit');
    const d = await attemptSettlement('bank', registry, sub('bank'));
    expect(d.kind).toBe('SUBMITTED');
    if (d.kind === 'SUBMITTED') expect(d.rail).toBe('wise');
  });

  it('reports EXHAUSTED when every rail refuses (all known states)', async () => {
    const registry = (rail: string) => makeProvider(rail, 'bank', 'reject');
    const d = await attemptSettlement('bank', registry, sub('bank'));
    expect(d.kind).toBe('EXHAUSTED');
    if (d.kind === 'EXHAUSTED') expect(d.attempts).toHaveLength(4);
  });
});

describe('fenced DeFi rails (Vultisig/Tegro)', () => {
  it('are visible in the chain but NEVER simulate success', async () => {
    const fenced = new FencedRailProvider('vultisig-defi', 'crypto');
    await expect(fenced.submit(sub('crypto'))).rejects.toBeInstanceOf(RailNotImplementedError);
    const registry = (rail: string) =>
      rail === 'vultisig-defi' ? fenced : makeProvider(rail, 'crypto', 'not-implemented');
    const d = await attemptSettlement('crypto', registry, sub('crypto'));
    expect(d.kind).toBe('EXHAUSTED');
    if (d.kind === 'EXHAUSTED') {
      expect(d.attempts.every((a) => a.outcome === 'NOT_IMPLEMENTED')).toBe(true);
    }
  });
});

describe('RailFallbackProvider (drop-in seam)', () => {
  it('namespaces providerRequestIds and routes fetchStatus back to the owning rail', async () => {
    const registry = (rail: string) => (rail === 'paypal' ? makeProvider(rail, 'paypal', 'submit') : null);
    const p = new RailFallbackProvider('paypal', registry);
    const r = await p.submit(sub('paypal'));
    expect(r.providerRequestId).toBe('paypal::req-paypal');
    expect(r.evidence.rail).toBe('paypal');
    // dry-run ids (dryrun-*) resolve UNKNOWN forever — honesty preserved
    const st = await p.fetchStatus('paypal::dryrun-paypal-abc');
    expect(st.status).toBe('UNKNOWN');
  });

  it('throws RailQuarantinedError on UNKNOWN (never fabricates a result)', async () => {
    const registry = (rail: string) => (rail === 'paypal' ? makeProvider(rail, 'paypal', 'explode') : null);
    const p = new RailFallbackProvider('paypal', registry);
    await expect(p.submit(sub('paypal'))).rejects.toThrow(/quarantined/);
  });
});
