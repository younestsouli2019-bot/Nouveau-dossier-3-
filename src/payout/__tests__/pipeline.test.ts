import { describe, expect, it } from 'vitest';
import { advancePayout, runPayoutTick, type ApplyTransitionArgs, type ApplyResult, type PayoutRecord, type PayoutStore, type PipelineConfig } from '../pipeline';
import type { LedgerEntry } from '../ledger';
import type { PayoutProvider, ProviderSubmission, ProviderSubmissionResult, ProviderStatusResult } from '../provider';
import { LivePathUnavailableError } from '../provider';

const FP = 'a'.repeat(64);

// ---------------------------------------------------------------------------
// In-memory store — same contract as prisma-driver, for driver verification.
// ---------------------------------------------------------------------------

class MemoryStore implements PayoutStore {
  payouts: PayoutRecord[] = [];
  ledger: LedgerEntry[] = [];
  holds = new Set<string>();
  pollReasons: string[] = [];
  failEventsToday = 0;

  getPayoutSync(id: string): PayoutRecord | undefined {
    return this.payouts.find((p) => p.id === id);
  }

  async getPayout(id: string): Promise<PayoutRecord | null> {
    return this.getPayoutSync(id) ?? null;
  }
  async listDrivablePayoutIds(limit: number): Promise<string[]> {
    const drivable = ['CREATED','ELIGIBLE','RESERVED','VALIDATED','READY','SUBMITTING','SUBMITTED','PROCESSING','COMPLETED','UNKNOWN','RETRYABLE_FAILURE','PROVIDER_REJECTED'];
    return this.payouts.filter((p) => drivable.includes(p.status)).slice(0, limit).map((p) => p.id);
  }
  async listLedgerEntries(ownerAccountId: string, currency: string): Promise<readonly LedgerEntry[]> {
    return this.ledger.filter((e) => e.ownerAccountId === ownerAccountId && e.currency === currency);
  }
  async hasActiveHold(payoutId: string): Promise<boolean> {
    return this.holds.has(payoutId);
  }
  async countFailedSubmitsToday(): Promise<number> {
    return this.failEventsToday;
  }
  async countProviderPolls(_payoutId: string, _sinceISO: string): Promise<number> {
    return this.pollReasons.filter((r) => r.startsWith('no verdict')).length;
  }
  async recordProviderPoll(payoutId: string, reason: string): Promise<void> {
    this.pollReasons.push(reason);
  }
  async applyTransition(args: ApplyTransitionArgs): Promise<ApplyResult> {
    const p = this.getPayoutSync(args.payoutId);
    if (!p) return { ok: false, error: 'missing payout' };
    if (p.version !== args.expectedVersion) {
      return { ok: false, error: `version conflict: expected ${args.expectedVersion}, got ${p.version}` };
    }
    p.status = args.to;
    p.version = args.expectedVersion + 1;
    if (args.patch) Object.assign(p, args.patch);
    if (args.ledger) {
      const key = args.ledger.idempotencyKey;
      const dup = this.ledger.some((e) => e.id === key);
      if (!dup) {
        this.ledger.push({
          id: key,
          ownerAccountId: p.ownerAccountId ?? 'OWNER',
          type: args.ledger.type,
          currency: p.currency,
          amount: -Math.abs(args.ledger.amount),
          sourceRef: args.ledger.processorRef,
          occurredAt: new Date().toISOString(),
        });
      }
    }
    return { ok: true, newVersion: p.version };
  }

  /** Test helper: fetch the live record. */
  rec(id: string): PayoutRecord {
    const p = this.getPayoutSync(id);
    if (!p) throw new Error(`no payout ${id}`);
    return p;
  }
}

// ---------------------------------------------------------------------------
// Fake providers
// ---------------------------------------------------------------------------

class FakeProvider implements PayoutProvider {
  readonly name = 'fake';
  readonly destinationType = 'paypal' as const;
  submitCalls = 0;
  poll = 0;
  behavior: 'ok' | 'pending-then-ok' | 'ambiguous' | 'rejected' | 'unavailable' = 'ok';

  async submit(s: ProviderSubmission): Promise<ProviderSubmissionResult> {
    this.submitCalls += 1;
    if (this.behavior === 'ambiguous') throw new Error('network died mid-flight');
    if (this.behavior === 'rejected') {
      return { providerRequestId: '', status: 'REJECTED', submittedAt: new Date().toISOString(), evidence: {} };
    }
    if (this.behavior === 'unavailable') {
      throw new LivePathUnavailableError('fake', 'rail not configured');
    }
    expect(s.destinationFingerprint).toBe(FP);
    return { providerRequestId: `req-${s.idempotencyKey}`, status: 'SUBMITTED', submittedAt: new Date().toISOString(), evidence: { dryRun: false } };
  }
  async fetchStatus(providerRequestId: string): Promise<ProviderStatusResult> {
    this.poll += 1;
    if (this.behavior === 'pending-then-ok' && this.poll === 1) {
      return { status: 'PENDING', evidence: {} };
    }
    return { status: 'COMPLETED', providerTransactionId: `txn-${providerRequestId}`, evidence: { dryRun: false } };
  }
}

// ---------------------------------------------------------------------------

function seedStore(overrides: Partial<PayoutRecord> = {}): MemoryStore {
  const store = new MemoryStore();
  store.payouts.push({
    id: 'po1',
    ownerAccountId: 'OWNER',
    settlementId: null,
    currency: 'USD',
    grossAmount: 100,
    feeAmount: 5,
    netAmount: 95,
    destinationType: 'paypal',
    destinationFingerprint: FP,
    idempotencyKey: 'idem-1',
    status: 'CREATED',
    provider: null,
    providerRequestId: null,
    providerTransactionId: null,
    reconciliationStatus: 'PENDING',
    version: 1,
    ...overrides,
  });
  store.ledger.push({
    id: 'rev1',
    ownerAccountId: 'OWNER',
    type: 'REVENUE',
    currency: 'USD',
    amount: 1000,
    sourceRef: 'rev-event-1',
    occurredAt: new Date().toISOString(),
  });
  return store;
}

const configOf = (p: FakeProvider): PipelineConfig => ({
  providers: (dt) => (dt === 'paypal' ? p : null),
});

async function tickToEnd(store: PayoutStore, config: PipelineConfig, maxTicks = 12): Promise<string> {
  let status = store === null ? '' : '';
  for (let i = 0; i < maxTicks; i++) {
    await runPayoutTick(store, config, 10);
    const rec = (store as MemoryStore).rec('po1');
    status = rec.status;
    if (status === 'RECONCILED' || status === 'QUARANTINED' || status === 'UNKNOWN' || status === 'CANCELLED') break;
  }
  return status;
}

describe('payout pipeline driver — full happy path', () => {
  it('walks CREATED -> ... -> RECONCILED through legal transitions only', async () => {
    const store = seedStore();
    const provider = new FakeProvider();
    const config = configOf(provider);

    // Tick 1: CREATED -> ELIGIBLE
    let out = await advancePayout(store, config, 'po1');
    expect(out).toMatchObject({ action: 'transitioned', to: 'ELIGIBLE' });

    // Tick 2: ELIGIBLE -> RESERVED (ledger reservation written)
    out = await advancePayout(store, config, 'po1');
    expect(out).toMatchObject({ action: 'transitioned', to: 'RESERVED' });
    expect(store.ledger.some((e) => e.type === 'PAYOUT_RESERVED' && e.amount === -95)).toBe(true);

    // Tick 3: RESERVED -> VALIDATED (policy validation)
    out = await advancePayout(store, config, 'po1');
    expect(out).toMatchObject({ action: 'transitioned', to: 'VALIDATED' });

    // Tick 4: VALIDATED -> READY
    out = await advancePayout(store, config, 'po1');
    expect(out).toMatchObject({ action: 'transitioned', to: 'READY' });

    // Tick 5: READY -> SUBMITTING -> SUBMITTED (claim + submit)
    out = await advancePayout(store, config, 'po1');
    expect(out).toMatchObject({ action: 'transitioned', to: 'SUBMITTED' });
    expect(provider.submitCalls).toBe(1);
    expect(store.rec('po1').providerRequestId).toBe('req-idem-1');

    // Tick 6: SUBMITTED -> (provider evidence) COMPLETED -> RECONCILED
    out = await advancePayout(store, config, 'po1');
    expect(out).toMatchObject({ action: 'transitioned', to: 'RECONCILED' });
    const rec = store.rec('po1');
    expect(rec.reconciliationStatus).toBe('RECONCILED');
    expect(rec.providerTransactionId).toBe('txn-req-idem-1');
    expect(store.ledger.some((e) => e.type === 'PAYOUT_SETTLED' && e.amount === -95)).toBe(true);

    // Terminal: further ticks are no-ops
    out = await advancePayout(store, config, 'po1');
    expect(out.action).toBe('terminal');
  });

  it('PENDING provider verdict transitions SUBMITTED -> PROCESSING, then completes', async () => {
    const store = seedStore({ status: 'SUBMITTED', providerRequestId: 'req-x' });
    const provider = new FakeProvider();
    provider.behavior = 'pending-then-ok';
    const config = configOf(provider);

    let out = await advancePayout(store, config, 'po1');
    expect(out).toMatchObject({ action: 'transitioned', to: 'PROCESSING' });
    out = await advancePayout(store, config, 'po1');
    expect(out).toMatchObject({ action: 'transitioned', to: 'RECONCILED' });
  });

  it('respects the daily settle cap at validation time', async () => {
    const store = seedStore({ status: 'RESERVED', netAmount: 2000 });
    // Already settled 9,000 in the last 24h — cap 10,000 => 2000 exceeds.
    store.ledger.push({
      id: 'prev', ownerAccountId: 'OWNER', type: 'PAYOUT_SETTLED', currency: 'USD',
      amount: -9000, sourceRef: 'prev-payout', occurredAt: new Date().toISOString(),
    });
    const config = { providers: () => new FakeProvider(), maxDailySettlePerCurrency: 10_000 };
    const out = await advancePayout(store, config, 'po1');
    expect(out.action).toBe('validation-failed');
    expect(store.rec('po1').status).toBe('RESERVED');
  });
});

describe('payout pipeline driver — UNKNOWN is never retried', () => {
  it('ambiguous submit -> UNKNOWN with EVIDENCE_PENDING, and resolution requires a provider verdict', async () => {
    const store = seedStore({ status: 'READY' });
    const provider = new FakeProvider();
    provider.behavior = 'ambiguous';
    const config = configOf(provider);

    let out = await advancePayout(store, config, 'po1');
    expect(out).toMatchObject({ action: 'transitioned', to: 'UNKNOWN' });
    expect(store.rec('po1').reconciliationStatus).toBe('EVIDENCE_PENDING');

    // The submit threw BEFORE any provider reference existed, so there is
    // nothing to reconcile against: the machine quarantines for review.
    // It NEVER re-submits (that could move money twice).
    out = await advancePayout(store, config, 'po1');
    expect(out).toMatchObject({ action: 'transitioned', to: 'QUARANTINED' });
    expect(provider.submitCalls).toBe(1); // no blind retry, ever

    // Resolution WITH a provider reference: verdict COMPLETED -> RECONCILED.
    const store2 = seedStore({
      status: 'UNKNOWN',
      provider: 'fake',
      providerRequestId: 'req-z',
      reconciliationStatus: 'EVIDENCE_PENDING',
    });
    const provider2 = new FakeProvider();
    const out2 = await advancePayout(store2, configOf(provider2), 'po1');
    expect(out2).toMatchObject({ action: 'transitioned', to: 'RECONCILED' });
    expect(provider2.submitCalls).toBe(0); // resolved by EVIDENCE, not resubmission
  });

  it('crash leftover SUBMITTING becomes UNKNOWN, never re-submitted', async () => {
    const store = seedStore({ status: 'SUBMITTING' });
    const provider = new FakeProvider();
    const config = configOf(provider);

    const out = await advancePayout(store, config, 'po1');
    expect(out).toMatchObject({ action: 'transitioned', to: 'UNKNOWN' });
    expect(provider.submitCalls).toBe(0);
  });

  it('UNKNOWN with a FAILED verdict quarantines (never PROVIDER_REJECTED, never retried)', async () => {
    const store = seedStore({ status: 'UNKNOWN', providerRequestId: 'req-q', reconciliationStatus: 'EVIDENCE_PENDING' });
    const provider = new FakeProvider();
    const config = configOf(provider);
    const failedProvider = new FakeProvider();
    failedProvider.behavior = 'pending-then-ok'; // unused shapes

    // Simulate provider verdict FAILED by overriding fetchStatus.
    const cfg: PipelineConfig = {
      providers: () => ({
        name: 'fake', destinationType: 'paypal',
        submit: () => { throw new Error('must not submit from UNKNOWN'); },
        fetchStatus: async () => ({ status: 'FAILED', evidence: {} }),
      }),
    };
    const out = await advancePayout(store, cfg, 'po1');
    expect(out).toMatchObject({ action: 'transitioned', to: 'QUARANTINED' });
  });
});

describe('payout pipeline driver — fail-closed submit', () => {
  it('LivePathUnavailable lands in RETRYABLE_FAILURE with an explicit reason', async () => {
    const store = seedStore({ status: 'READY' });
    const provider = new FakeProvider();
    provider.behavior = 'unavailable';
    const config = configOf(provider);

    const out = await advancePayout(store, config, 'po1');
    expect(out).toMatchObject({ action: 'transitioned', to: 'RETRYABLE_FAILURE' });
    expect(store.rec('po1').failureCode).toBe('LIVE_PATH_UNAVAILABLE');
  });

  it('submit throttles after the daily failure cap', async () => {
    const store = seedStore({ status: 'RETRYABLE_FAILURE' });
    store.failEventsToday = 3;
    const provider = new FakeProvider();
    const config = configOf(provider);

    const out = await advancePayout(store, config, 'po1');
    expect(out.action).toBe('submit-throttled');
    expect(store.rec('po1').status).toBe('RETRYABLE_FAILURE');
  });
});

describe('payout pipeline driver — reservation integrity', () => {
  it('ELIGIBLE with insufficient available balance is a no-op, never a forced reserve', async () => {
    const store = seedStore({ status: 'ELIGIBLE', netAmount: 5000 }); // only 1000 available
    const config = configOf(new FakeProvider());
    const out = await advancePayout(store, config, 'po1');
    expect(out.action).toBe('insufficient-available');
    expect(store.rec('po1').status).toBe('ELIGIBLE');
  });

  it('active hold blocks CREATED -> ELIGIBLE', async () => {
    const store = seedStore();
    store.holds.add('po1');
    const config = configOf(new FakeProvider());
    const out = await advancePayout(store, config, 'po1');
    expect(out.action).toBe('held');
    expect(store.rec('po1').status).toBe('CREATED');
  });

  it('invalid destination fingerprint parks at RESERVED with a validation-failed detail', async () => {
    const store = seedStore({ status: 'RESERVED', destinationFingerprint: 'not-hex' });
    const config = configOf(new FakeProvider());
    const out = await advancePayout(store, config, 'po1');
    expect(out.action).toBe('validation-failed');
    expect(out.detail).toContain('fingerprint');
    expect(store.rec('po1').status).toBe('RESERVED');
  });
});

describe('payout pipeline driver — concurrency', () => {
  it('version conflict is reported, never force-applied', async () => {
    const store = seedStore({ status: 'ELIGIBLE' });
    // A racing writer bumped the version between our read and our write.
    const originalApply = store.applyTransition.bind(store);
    store.applyTransition = async (args) =>
      ({ ok: false, error: `version conflict: expected ${args.expectedVersion}, got ${args.expectedVersion + 1}` });
    const config = configOf(new FakeProvider());
    const out = await advancePayout(store, config, 'po1');
    expect(out.action).toBe('error');
    expect(out.detail).toContain('version conflict');
  });
});

describe('runPayoutTick — bounded batch', () => {
  it('advances every drivable payout once per tick and stops at terminal states', async () => {
    const store = seedStore();
    const provider = new FakeProvider();
    const config = configOf(provider);
    const final = await tickToEnd(store, config);
    expect(final).toBe('RECONCILED');
    const report = await runPayoutTick(store, config, 10);
    expect(report.considered).toBe(0); // nothing drivable left
  });
});
