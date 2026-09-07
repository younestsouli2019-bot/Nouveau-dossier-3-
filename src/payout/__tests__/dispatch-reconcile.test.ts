import { describe, expect, it, vi } from 'vitest';
import {
  atomicTransition,
  dispatchPayout,
  preparePayout,
  providerConfigFromEnv,
  type DispatchPayoutRow,
  type DispatchPrismaClient,
} from '../dispatch';
import {
  advancePayoutReconciliation,
  reconcileAllPayouts,
  type ReconcileDeps,
} from '../reconcile';
import type { PayoutProvider, ProviderSubmissionResult, ProviderStatusResult } from '../provider';
import { LivePathUnavailableError } from '../provider';

const FP = 'a'.repeat(64);

function basePayout(overrides: Partial<DispatchPayoutRow> = {}): DispatchPayoutRow {
  return {
    id: 'po_1',
    ownerAccountId: 'oa_1',
    currency: 'USD',
    netAmount: 100,
    destinationType: 'paypal',
    destinationFingerprint: FP,
    idempotencyKey: 'idem-po_1',
    status: 'READY',
    provider: null,
    providerRequestId: null,
    providerTransactionId: null,
    reconciliationStatus: 'PENDING',
    version: 1,
    ...overrides,
  };
}

interface StoreState {
  rows: Map<string, DispatchPayoutRow>;
  events: Array<Record<string, unknown>>;
  ledger: Map<string, { id: string }>;
}

function makeStore(seed: DispatchPayoutRow[] = []) {
  const state: StoreState = {
    rows: new Map(seed.map((r) => [r.id, { ...r }])),
    events: [],
    ledger: new Map(),
  };
  const prisma: DispatchPrismaClient = {
    payout: {
      findUnique: vi.fn(async (args?: any) => {
        const id = args?.where?.id ?? args?.where?.unique?.id;
        return state.rows.get(id) ? { ...state.rows.get(id)! } : null;
      }),
      findMany: vi.fn(async (args?: any) => {
        let rows = [...state.rows.values()];
        const w = args?.where;
        if (w?.status?.in) rows = rows.filter((r) => w.status.in.includes(r.status));
        if (w?.OR) {
          const match = (r: DispatchPayoutRow) =>
            w.OR.some((clause: any) => {
              if (clause.status?.in && !clause.status.in.includes(r.status)) return false;
              if (clause.AND) {
                return clause.AND.every((c: any) =>
                  c.status && r.status !== c.status ? false : !(c.reconciliationStatus?.not && r.reconciliationStatus === c.reconciliationStatus.not)
                );
              }
              return true;
            });
          rows = rows.filter(match);
        }
        return rows.map((r) => ({ ...r }));
      }),
      updateMany: vi.fn(async (args: any) => {
        const w = args.where;
        let count = 0;
        for (const [id, row] of state.rows) {
          if (w.id && id !== w.id) continue;
          if (w.status && row.status !== w.status) continue;
          if (w.version !== undefined && row.version !== w.version) continue;
          Object.assign(state.rows.get(id)!, args.data);
          count++;
        }
        return { count };
      }),
    },
    payoutEvent: {
      create: vi.fn(async (args: any) => {
        state.events.push(args.data ?? args);
        return {};
      }),
    },
    payoutHold: {
      count: vi.fn(async () => 0),
    },
    $transaction: vi.fn(async (fn: any) => fn({
      payout: {
        updateMany: async (args: any) => {
          const w = args.where;
          let count = 0;
          for (const [id, row] of state.rows) {
            if (w.id && id !== w.id) continue;
            if (w.status && row.status !== w.status) continue;
            if (w.version !== undefined && row.version !== w.version) continue;
            Object.assign(state.rows.get(id)!, args.data);
            count++;
          }
          return { count };
        },
      },
      payoutEvent: {
        create: async (args: any) => {
          state.events.push(args.data ?? args);
          return {};
        },
      },
    })),
  };
  const ledger = {
    findUnique: vi.fn(async (args: any) => state.ledger.get(args?.where?.idempotencyKey) ?? null),
    create: vi.fn(async (args: any) => {
      const key = args.data.idempotencyKey;
      const rec = { id: `le_${state.ledger.size + 1}` };
      state.ledger.set(key, rec);
      return rec;
    }),
  };
  return { prisma, ledger, state };
}

function fakeProvider(
  behavior: Partial<Record<'submit' | 'fetchStatus', () => Promise<ProviderSubmissionResult | ProviderStatusResult>>>
): PayoutProvider {
  return {
    name: 'paypal-test',
    destinationType: 'paypal',
    submit: vi.fn(behavior.submit ?? (async () => ({
      providerRequestId: 'REQ-1',
      status: 'SUBMITTED' as const,
      submittedAt: new Date().toISOString(),
      evidence: { ok: true },
    }))),
    fetchStatus: vi.fn(behavior.fetchStatus ?? (async () => ({
      status: 'COMPLETED' as const,
      providerTransactionId: 'TX-1',
      evidence: { settled: true },
    }))),
  } as unknown as PayoutProvider;
}

const deps = (store: ReturnType<typeof makeStore>, provider: PayoutProvider): ReconcileDeps => ({
  prisma: store.prisma,
  ledger: store.ledger,
  providerFor: () => provider,
  env: { SWARM_LIVE: 'true' } as NodeJS.ProcessEnv,
  now: () => new Date('2026-09-07T15:00:00Z'),
});

describe('providerConfigFromEnv', () => {
  it('is fail-closed without SWARM_LIVE', () => {
    expect(providerConfigFromEnv({}).live).toBe(false);
    expect(providerConfigFromEnv({ SWARM_LIVE: 'false' }).live).toBe(false);
    expect(providerConfigFromEnv({ SWARM_LIVE: 'TRUE' }).live).toBe(true);
  });
});

describe('preparePayout (RESERVED -> READY, manual approval)', () => {
  it('refuses without an owner approval signature (fail-closed)', async () => {
    const store = makeStore([basePayout({ status: 'RESERVED' })]);
    const res = await preparePayout('po_1', { approvedBy: '', approvalReason: '' }, { prisma: store.prisma });
    expect(res.ok).toBe(false);
    expect(store.state.rows.get('po_1')!.status).toBe('RESERVED'); // untouched
  });

  it('refuses when active holds exist', async () => {
    const store = makeStore([basePayout({ status: 'RESERVED' })]);
    store.prisma.payoutHold.count = vi.fn(async () => 1);
    const res = await preparePayout('po_1', { approvedBy: 'owner', approvalReason: 'ok' }, { prisma: store.prisma });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('hold');
  });

  it('drives RESERVED -> VALIDATED -> READY with owner event recorded', async () => {
    const store = makeStore([basePayout({ status: 'RESERVED' })]);
    const res = await preparePayout('po_1', { approvedBy: 'owner', approvalReason: 'approved Sept 7' }, { prisma: store.prisma });
    expect(res.ok).toBe(true);
    const row = store.state.rows.get('po_1')!;
    expect(row.status).toBe('READY');
    expect(row.version).toBe(3);
    const ownerEvent = store.state.events.find((e) => (e as any).actor === 'owner');
    expect(ownerEvent).toBeTruthy();
    expect(String((ownerEvent as any).reason)).toContain('approved Sept 7');
  });
});

describe('dispatchPayout (READY -> SUBMITTED)', () => {
  it('happy path: READY -> SUBMITTING -> SUBMITTED with provider refs', async () => {
    const store = makeStore([basePayout({ status: 'READY' })]);
    const provider = fakeProvider({});
    const res = await dispatchPayout('po_1', deps(store, provider));
    expect(res.ok).toBe(true);
    const row = store.state.rows.get('po_1')!;
    expect(row.status).toBe('SUBMITTED');
    expect(row.providerRequestId).toBe('REQ-1');
    expect(row.reconciliationStatus).toBe('PENDING');
  });

  it('is idempotent: refuses to re-dispatch an in-flight payout', async () => {
    const store = makeStore([basePayout({ status: 'SUBMITTED' })]);
    const provider = fakeProvider({});
    const res = await dispatchPayout('po_1', deps(store, provider));
    expect(res.ok).toBe(false);
    expect(res.error).toContain('never re-submitted');
    expect(provider.submit).not.toHaveBeenCalled();
  });

  it('live-gate miss is provably nothing-sent: RETRYABLE_FAILURE', async () => {
    const store = makeStore([basePayout({ status: 'READY' })]);
    const provider = fakeProvider({
      submit: async () => {
        throw new LivePathUnavailableError('paypal-test', 'not configured');
      },
    });
    const res = await dispatchPayout('po_1', deps(store, provider));
    expect(res.ok).toBe(false);
    expect(res.status).toBe('RETRYABLE_FAILURE');
    expect(store.state.rows.get('po_1')!.status).toBe('RETRYABLE_FAILURE');
  });

  it('ambiguous error becomes UNKNOWN + RECONCILIATION_REQUIRED (never retried)', async () => {
    const store = makeStore([basePayout({ status: 'READY' })]);
    const provider = fakeProvider({
      submit: async () => {
        throw new Error('ETIMEDOUT after request sent');
      },
    });
    const res = await dispatchPayout('po_1', deps(store, provider));
    expect(res.ok).toBe(false);
    expect(res.status).toBe('UNKNOWN');
    const row = store.state.rows.get('po_1')!;
    expect(row.status).toBe('UNKNOWN');
    expect(row.reconciliationStatus).toBe('RECONCILIATION_REQUIRED');
    // and the state machine refuses a blind retry back to READY
    const retry = await atomicTransition(store.prisma, {
      payoutId: 'po_1', from: 'UNKNOWN', to: 'READY', actor: 'system',
      reason: 'blind retry attempt', expectedVersion: row.version,
    });
    expect(retry.ok).toBe(false);
  });
});

describe('advancePayoutReconciliation (SUBMITTED -> RECONCILED)', () => {
  it('provider COMPLETED: books the ledger line then RECONCILED', async () => {
    const store = makeStore([basePayout({ status: 'PROCESSING', providerRequestId: 'REQ-1', version: 3 })]);
    const provider = fakeProvider({});
    const res = await advancePayoutReconciliation('po_1', deps(store, provider));
    expect(res.ok).toBe(true);
    expect(res.to).toBe('RECONCILED');
    const row = store.state.rows.get('po_1')!;
    expect(row.status).toBe('RECONCILED');
    expect(row.reconciliationStatus).toBe('RECONCILED');
    expect(row.providerTransactionId).toBe('TX-1');
    // ledger booked exactly once with the idempotent key
    expect(store.ledger.create).toHaveBeenCalledTimes(1);
    expect(store.state.ledger.has('payout-settled:po_1')).toBe(true);
    const meta = (store.ledger.create as any).mock.calls[0][0].data.metadata;
    expect(meta.ledgerType).toBe('PAYOUT_SETTLED');
    expect(meta.destinationFingerprint).toBe(FP);
  });

  it('provider PENDING: SUBMITTED -> PROCESSING only', async () => {
    const store = makeStore([basePayout({ status: 'SUBMITTED', providerRequestId: 'REQ-1' })]);
    const provider = fakeProvider({ fetchStatus: async () => ({ status: 'PENDING' as const, evidence: {} }) });
    const res = await advancePayoutReconciliation('po_1', deps(store, provider));
    expect(res.ok).toBe(true);
    expect(res.to).toBe('PROCESSING');
    expect(store.state.rows.get('po_1')!.status).toBe('PROCESSING');
    expect(store.state.ledger.size).toBe(0); // nothing booked yet
  });

  it('UNKNOWN payout + provider FAILED: resolves to QUARANTINED, never READY', async () => {
    const store = makeStore([basePayout({ status: 'UNKNOWN', providerRequestId: 'REQ-1', version: 2 })]);
    const provider = fakeProvider({ fetchStatus: async () => ({ status: 'FAILED' as const, evidence: {} }) });
    const res = await advancePayoutReconciliation('po_1', deps(store, provider));
    expect(res.ok).toBe(true);
    expect(res.to).toBe('QUARANTINED');
    expect(store.state.rows.get('po_1')!.reconciliationStatus).toBe('QUARANTINED');
  });

  it('UNKNOWN payout + provider UNKNOWN verdict: stays, flagged, no retry', async () => {
    const store = makeStore([basePayout({ status: 'UNKNOWN', providerRequestId: 'REQ-1', version: 2 })]);
    const provider = fakeProvider({ fetchStatus: async () => ({ status: 'UNKNOWN' as const, evidence: {} }) });
    const res = await advancePayoutReconciliation('po_1', deps(store, provider));
    expect(res.ok).toBe(false);
    expect(res.flagged).toBe(true);
    expect(store.state.rows.get('po_1')!.status).toBe('UNKNOWN');
    expect(store.state.rows.get('po_1')!.reconciliationStatus).toBe('RECONCILIATION_REQUIRED');
  });

  it('in-flight payout without providerRequestId: flagged for history pull', async () => {
    const store = makeStore([basePayout({ status: 'SUBMITTED', providerRequestId: null })]);
    const provider = fakeProvider({});
    const res = await advancePayoutReconciliation('po_1', deps(store, provider));
    expect(res.ok).toBe(false);
    expect(res.flagged).toBe(true);
    expect(res.error).toContain('history pull');
  });

  it('COMPLETED-but-unreconciled payout: finishes booking + RECONCILED (crash-safe)', async () => {
    const store = makeStore([basePayout({ status: 'COMPLETED', version: 4 })]);
    const provider = fakeProvider({});
    const res = await advancePayoutReconciliation('po_1', deps(store, provider));
    expect(res.ok).toBe(true);
    expect(res.to).toBe('RECONCILED');
    expect(store.ledger.create).toHaveBeenCalledTimes(1);
  });
});

describe('reconcileAllPayouts sweep', () => {
  it('sweeps every in-flight + unreconciled payout once', async () => {
    const store = makeStore([
      basePayout({ id: 'po_a', status: 'PROCESSING', providerRequestId: 'R-a', version: 3 }),
      basePayout({ id: 'po_b', status: 'SUBMITTED', providerRequestId: 'R-b' }),
      basePayout({ id: 'po_c', status: 'UNKNOWN', providerRequestId: null, version: 2 }),
      basePayout({ id: 'po_d', status: 'CREATED' }), // untouched — not in scope
    ]);
    const provider = fakeProvider({});
    const summary = await reconcileAllPayouts(deps(store, provider));
    expect(summary.checked).toBe(3); // a + b + c ; d excluded
    expect(summary.advanced).toBe(2); // a -> RECONCILED, b -> PROCESSING (PENDING advance ok:true)
    expect(summary.flagged).toBe(1); // c: no providerRequestId
    expect(store.state.rows.get('po_d')!.status).toBe('CREATED');
    expect(store.state.rows.get('po_a')!.status).toBe('RECONCILED');
  });
});

describe('end-to-end: RESERVED to fully executed', () => {
  it('prepare -> dispatch -> reconcile lands RECONCILED with settlement booked', async () => {
    const store = makeStore([basePayout({ status: 'RESERVED' })]);
    const provider = fakeProvider({});
    const d = deps(store, provider);

    const prep = await preparePayout('po_1', { approvedBy: 'owner', approvalReason: 'e2e' }, d);
    expect(prep.ok).toBe(true);
    const disp = await dispatchPayout('po_1', d);
    expect(disp.ok).toBe(true);
    const rec = await advancePayoutReconciliation('po_1', d);
    expect(rec.ok).toBe(true);
    expect(rec.to).toBe('RECONCILED');

    const row = store.state.rows.get('po_1')!;
    expect(row.status).toBe('RECONCILED');
    expect(row.reconciliationStatus).toBe('RECONCILED');
    // full event trail: RESERVED->VALIDATED->READY->SUBMITTING->SUBMITTED->COMPLETED->RECONCILED
    const transitions = store.state.events
      .filter((e) => (e as any).fromStatus && (e as any).fromStatus !== (e as any).toStatus)
      .map((e) => `${(e as any).fromStatus}->${(e as any).toStatus}`);
    expect(transitions).toEqual([
      'RESERVED->VALIDATED',
      'VALIDATED->READY',
      'READY->SUBMITTING',
      'SUBMITTING->SUBMITTED',
      'SUBMITTED->PROCESSING',
      'PROCESSING->COMPLETED',
      'COMPLETED->RECONCILED',
    ]);
  });
});
