import { describe, it, expect } from 'vitest';
import {
  SettlementState,
  VALID_TRANSITIONS,
  isSyntheticRef,
  SYNTHETIC_REF_REGEX,
} from '../SettlementEngine';
import { resolveBestPayoutRoute } from '../../payout-routing';

function assertValidTransition(from: SettlementState, to: SettlementState): void {
  const allowed = VALID_TRANSITIONS[from];
  expect(allowed).toBeDefined();
  expect(allowed.has(to)).toBe(true);
}

function assertForbiddenTransition(from: SettlementState, to: SettlementState): void {
  const allowed = VALID_TRANSITIONS[from];
  expect(allowed).toBeDefined();
  expect(allowed.has(to)).toBe(false);
}

describe('T1 — SettlementState Validity Matrix', () => {
  it('REVENUE only allows → RECONCILED | REJECTED', () => {
    assertValidTransition(SettlementState.REVENUE, SettlementState.RECONCILED);
    assertValidTransition(SettlementState.REVENUE, SettlementState.REJECTED);
    assertForbiddenTransition(SettlementState.REVENUE, SettlementState.SETTLED);
    assertForbiddenTransition(SettlementState.REVENUE, SettlementState.PROCESSING);
  });

  it('PROCESSING allows → PROVIDER_RECONCILED | UNKNOWN | REJECTED | QUARANTINED', () => {
    assertValidTransition(SettlementState.PROCESSING, SettlementState.PROVIDER_RECONCILED);
    assertValidTransition(SettlementState.PROCESSING, SettlementState.UNKNOWN);
    assertValidTransition(SettlementState.PROCESSING, SettlementState.REJECTED);
    assertValidTransition(SettlementState.PROCESSING, SettlementState.QUARANTINED);
    assertForbiddenTransition(SettlementState.PROCESSING, SettlementState.SETTLED);
  });

  it('UNKNOWN allows → PROVIDER_RECONCILED | QUARANTINED | REJECTED | PROCESSING', () => {
    assertValidTransition(SettlementState.UNKNOWN, SettlementState.PROVIDER_RECONCILED);
    assertValidTransition(SettlementState.UNKNOWN, SettlementState.QUARANTINED);
    assertValidTransition(SettlementState.UNKNOWN, SettlementState.REJECTED);
    assertValidTransition(SettlementState.UNKNOWN, SettlementState.PROCESSING);
    assertForbiddenTransition(SettlementState.UNKNOWN, SettlementState.SETTLED);
  });

  it('PROVIDER_RECONCILED → CONFIRMED | REJECTED | QUARANTINED only, never → SETTLED directly', () => {
    assertValidTransition(SettlementState.PROVIDER_RECONCILED, SettlementState.CONFIRMED);
    assertValidTransition(SettlementState.PROVIDER_RECONCILED, SettlementState.REJECTED);
    assertValidTransition(SettlementState.PROVIDER_RECONCILED, SettlementState.QUARANTINED);
    assertForbiddenTransition(SettlementState.PROVIDER_RECONCILED, SettlementState.SETTLED);
  });

  it('CONFIRMED → SETTLED and REJECTED (2-way reconciliation gate)', () => {
    assertValidTransition(SettlementState.CONFIRMED, SettlementState.SETTLED);
    assertValidTransition(SettlementState.CONFIRMED, SettlementState.REJECTED);
  });

  it('4 TERMINAL states (SETTLED/REJECTED/CANCELLED/EXPIRED) have ZERO outgoing; QUARANTINED has 2 recovery edges (PROVIDER_RECONCILED | REJECTED)', () => {
    const terminalStates = [
      SettlementState.SETTLED,
      SettlementState.REJECTED,
      SettlementState.CANCELLED,
      SettlementState.EXPIRED,
    ];
    for (const t of terminalStates) {
      expect(VALID_TRANSITIONS[t].size).toBe(0);
    }
    expect(VALID_TRANSITIONS[SettlementState.QUARANTINED].has(SettlementState.PROVIDER_RECONCILED)).toBe(true);
    expect(VALID_TRANSITIONS[SettlementState.QUARANTINED].has(SettlementState.REJECTED)).toBe(true);
    expect(VALID_TRANSITIONS[SettlementState.QUARANTINED].size).toBe(2);
  });

  it('Full lifecycle: REVENUE→…→SETTLED traverses 14 transitions (13 stages)', () => {
    const path: SettlementState[] = [
      SettlementState.REVENUE,
      SettlementState.RECONCILED,
      SettlementState.OWNER_ENTITLEMENT,
      SettlementState.PAYOUT_PROPOSAL,
      SettlementState.POLICY,
      SettlementState.RESERVATION,
      SettlementState.INSTRUCTION,
      SettlementState.IDEMPOTENCY,
      SettlementState.PROVIDER_SUBMITTED,
      SettlementState.PROCESSING,
      SettlementState.PROVIDER_RECONCILED,
      SettlementState.CONFIRMED,
      SettlementState.SETTLED,
    ];
    for (let i = 0; i < path.length - 1; i++) {
      assertValidTransition(path[i], path[i + 1]);
    }
    expect(path.length - 1).toBeGreaterThanOrEqual(12);
  });
});

describe('T2 — isSyntheticRef: blocks fabricated refs that mirror audit findings', () => {
  it('rejects PB- (PayoutBatch synthetic)', () => expect(isSyntheticRef('PB-1725638492-842')).toBe(true));
  it('ACCEPTS RECOVER- / RECOVERY- / RECOVERED- / MISPLACED- prefixes as LEGIT recovery-stamped refs (NOT synthetic, NOTHING GETS LOST)', () => {
    expect(isSyntheticRef('RECOVER-2026-0907-recovered-from-quarantine')).toBe(false);
    expect(isSyntheticRef('RECOVERY-abc123-found-lost-txn')).toBe(false);
    expect(isSyntheticRef('RECOVERED-9-bank-statement-matched')).toBe(false);
    expect(isSyntheticRef('MISPLACED-842-found-on-audit')).toBe(false);
  });
  it('rejects INSTRUCTIONS_READY / WAITING_MANUAL / REVIEWED literal (still synthetic)', () => {
    expect(isSyntheticRef('INSTRUCTIONS_READY')).toBe(true);
    expect(isSyntheticRef('WAITING_MANUAL')).toBe(true);
    expect(isSyntheticRef('REVIEWED')).toBe(true);
  });
  it('accepts real-looking on-chain tx hashes (0x + 64 hex)', () => {
    const realEthTx = '0x' + 'a'.repeat(64);
    expect(isSyntheticRef(realEthTx)).toBe(false);
  });
  it('accepts real Stripe/PayPal/Wise transfer IDs', () => {
    expect(isSyntheticRef('pi_3Pabcdef123456secret')).toBe(false);
    expect(isSyntheticRef('5WJ4321XXXXX98765')).toBe(false);
    expect(isSyntheticRef('TRANSFER-1-99ABCDEFabcdef')).toBe(false);
  });
  it('accepts real Attijari WPS ref (letters + digits + 20+ chars)', () => {
    expect(isSyntheticRef('WPS-2026-9A8B7C6D5E4F-9981')).toBe(false);
  });
  it('accepts real MT103 UETR (36 chars with dashes UUID-ish)', () => {
    expect(isSyntheticRef('123e4567-e89b-12d3-a456-426614174000')).toBe(false);
  });
  it('null/empty = synthetic (fail-closed)', () => {
    expect(isSyntheticRef(null)).toBe(true);
    expect(isSyntheticRef(undefined)).toBe(true);
    expect(isSyntheticRef('')).toBe(true);
  });
  it('SYNTHETIC_REF_REGEX is exposed for truth-guards reuse', () => {
    expect(SYNTHETIC_REF_REGEX instanceof RegExp).toBe(true);
    expect(SYNTHETIC_REF_REGEX.test('PB-FOO')).toBe(true);
  });
});

describe('T3 — resolveBestPayoutRoute verifiedAt-only filter (AC15 enforced)', () => {
  const baseAccount = (patch: Partial<{ isActive: boolean; verifiedAt: Date | null; accountType: string; id: string }>) => ({
    id: 'oa-' + Math.random().toString(36).slice(2, 10),
    isActive: true,
    verifiedAt: new Date(),
    accountType: 'paypal',
    ...patch,
  });

  it('returns null when zero accounts are verified', () => {
    const res = resolveBestPayoutRoute({
      amount: 100, currency: 'USD',
      ownerAccounts: [baseAccount({ verifiedAt: null }), baseAccount({ verifiedAt: null, isActive: false })],
    });
    expect(res).toBeNull();
  });

  it('returns null when all are inactive even if verified', () => {
    const res = resolveBestPayoutRoute({
      amount: 100, currency: 'USD',
      ownerAccounts: [baseAccount({ isActive: false })],
    });
    expect(res).toBeNull();
  });

  it('picks preferredRail match first when present (scoring weight 1000)', () => {
    const paypal = baseAccount({ id: 'pp', accountType: 'paypal' });
    const bank = baseAccount({ id: 'bw', accountType: 'bank_wire' });
    const res = resolveBestPayoutRoute({
      amount: 100, currency: 'USD', ownerAccounts: [paypal, bank], preferredRail: 'bank_wire',
    });
    expect(res).not.toBeNull();
    expect(res!.ownerAccountId).toBe('bw');
    expect(res!.rail).toBe('bank_wire');
  });

  it('falls back to isPrimary bonus when no preferredRail', () => {
    const a1 = baseAccount({ id: 'secondary', accountType: 'payoneer' }) as ReturnType<typeof baseAccount> & { isPrimary?: boolean };
    const a2 = baseAccount({ id: 'primary', accountType: 'payoneer' }) as ReturnType<typeof baseAccount> & { isPrimary?: boolean };
    a2.isPrimary = true;
    const res = resolveBestPayoutRoute({
      amount: 500, currency: 'EUR', ownerAccounts: [a1, a2],
    });
    expect(res!.ownerAccountId).toBe('primary');
  });

  it('rejects accountType with unknown rail mapping → filtered out', () => {
    const weird = baseAccount({ id: 'xx', accountType: 'completely_bogus_type' });
    const good = baseAccount({ id: 'ok', accountType: 'wise' });
    const res = resolveBestPayoutRoute({ amount: 1, currency: 'USD', ownerAccounts: [weird, good] });
    expect(res).not.toBeNull();
    expect(res!.ownerAccountId).toBe('ok');
  });
});
