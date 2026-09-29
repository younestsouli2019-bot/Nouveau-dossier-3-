import { describe, expect, it } from 'vitest';
import { canReserve, deriveBalance, type LedgerEntry } from '../ledger';
import {
  assertTransition,
  isRetrySafe,
  type TransitionInput,
} from '../state-machine';
import {
  STALE_HOLD_HOURS,
  describeStaleHold,
  isStale,
  type HoldRecord,
} from '../eligibility';

function transition(overrides: Partial<TransitionInput> = {}): TransitionInput {
  return {
    from: 'READY',
    to: 'SUBMITTING',
    actor: 'system',
    reason: 'advance payout',
    expectedVersion: 4,
    ...overrides,
  };
}

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: 'entry-1',
    ownerAccountId: 'owner-1',
    type: 'REVENUE',
    currency: 'USD',
    amount: 0,
    sourceRef: 'src-1',
    occurredAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function hold(overrides: Partial<HoldRecord> = {}): HoldRecord {
  return {
    payoutId: 'payout-1',
    holdReason: 'HELD_POLICY_REVIEW',
    createdAt: '2026-09-01T00:00:00.000Z',
    nextReviewAt: '2026-09-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('payout state machine primitives', () => {
  it('accepts legal transitions and bumps the optimistic version', () => {
    expect(assertTransition(transition())).toEqual({
      ok: true,
      from: 'READY',
      to: 'SUBMITTING',
      newVersion: 5,
      reason: 'advance payout',
    });
  });

  it('rejects illegal transitions with a helpful legal-transition list', () => {
    const result = assertTransition(
      transition({ from: 'CREATED', to: 'PROCESSING', expectedVersion: 1 })
    );

    expect(result.ok).toBe(false);
    expect(result.newVersion).toBe(1);
    expect(result.error).toContain('illegal transition CREATED -> PROCESSING');
    expect(result.error).toContain('ELIGIBLE');
    expect(result.error).toContain('CANCELLED');
  });

  it('only allows UNKNOWN resolution by provider reconciliation actors', () => {
    const blocked = assertTransition(
      transition({ from: 'UNKNOWN', to: 'COMPLETED', actor: 'watchdog' })
    );
    const allowed = assertTransition(
      transition({ from: 'UNKNOWN', to: 'QUARANTINED', actor: 'provider' })
    );

    expect(blocked).toMatchObject({
      ok: false,
      error: 'UNKNOWN resolves only via provider reconciliation',
    });
    expect(allowed).toMatchObject({
      ok: true,
      newVersion: 5,
    });
  });

  it('marks only provider-rejected and retryable failures as safe to retry', () => {
    expect(isRetrySafe('RETRYABLE_FAILURE')).toBe(true);
    expect(isRetrySafe('PROVIDER_REJECTED')).toBe(true);
    expect(isRetrySafe('UNKNOWN')).toBe(false);
    expect(isRetrySafe('READY')).toBe(false);
  });
});

describe('payout ledger primitives', () => {
  it('derives spendable balance from credits, fees, reservations, releases, and settlements', () => {
    const balance = deriveBalance('owner-1', 'USD', [
      entry({ id: 'rev', type: 'REVENUE', amount: 200 }),
      entry({ id: 'ent', type: 'OWNER_ENTITLEMENT', amount: 50 }),
      entry({ id: 'adj', type: 'ADJUSTMENT', amount: -10 }),
      entry({ id: 'fee', type: 'PLATFORM_FEE', amount: 30 }),
      entry({ id: 'res', type: 'PAYOUT_RESERVED', amount: 80 }),
      entry({ id: 'rel', type: 'PAYOUT_RELEASED', amount: 20 }),
      entry({ id: 'set', type: 'PAYOUT_SETTLED', amount: 40 }),
      entry({ id: 'other-owner', ownerAccountId: 'owner-2', type: 'REVENUE', amount: 999 }),
      entry({ id: 'other-currency', currency: 'EUR', type: 'REVENUE', amount: 999 }),
    ]);

    expect(balance).toEqual({
      ownerAccountId: 'owner-1',
      currency: 'USD',
      credits: 210,
      reservations: 60,
      settledPayouts: 40,
      available: 110,
    });
  });

  it('allows reservations only for positive amounts within available balance', () => {
    const balance = {
      ownerAccountId: 'owner-1',
      currency: 'USD',
      credits: 100,
      reservations: 25,
      settledPayouts: 10,
      available: 65,
    };

    expect(canReserve(65, balance)).toBe(true);
    expect(canReserve(66, balance)).toBe(false);
    expect(canReserve(0, balance)).toBe(false);
  });
});

describe('payout hold eligibility primitives', () => {
  it('treats released or invalid holds as not stale', () => {
    const now = new Date('2026-09-04T00:00:00.000Z');

    expect(
      isStale(hold({ releasedAt: '2026-09-03T00:00:00.000Z' }), now)
    ).toBe(false);
    expect(isStale(hold({ createdAt: 'not-a-date' }), now)).toBe(false);
  });

  it('marks holds stale at the review threshold or when expired', () => {
    const thresholdNow = new Date('2026-09-04T00:00:00.000Z');
    const expiredNow = new Date('2026-09-01T12:00:00.000Z');

    expect(
      isStale(
        hold({
          createdAt: new Date(
            thresholdNow.getTime() - STALE_HOLD_HOURS * 3_600_000
          ).toISOString(),
        }),
        thresholdNow
      )
    ).toBe(true);
    expect(
      isStale(
        hold({
          createdAt: '2026-09-01T00:00:00.000Z',
          expiresAt: '2026-09-01T11:00:00.000Z',
        }),
        expiredNow
      )
    ).toBe(true);
  });

  it('describes stale holds with one-decimal-hour precision', () => {
    const now = new Date('2026-09-02T06:15:00.000Z');

    expect(
      describeStaleHold(
        hold({
          createdAt: '2026-09-01T00:00:00.000Z',
          nextReviewAt: '2026-09-02T12:00:00.000Z',
        }),
        now
      )
    ).toEqual({
      payoutId: 'payout-1',
      holdReason: 'HELD_POLICY_REVIEW',
      heldForHours: 30.3,
      nextReviewAt: '2026-09-02T12:00:00.000Z',
    });
  });
});
