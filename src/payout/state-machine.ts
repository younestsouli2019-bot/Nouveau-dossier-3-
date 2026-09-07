/**
 * Durable payout state machine — the ONLY authority over Payout.status.
 *
 * Settlement-gap P0 (2026-09-07). Every transition is explicit, legal, and
 * recorded as an immutable PayoutEvent. Nothing else in the codebase may
 * assign Payout.status directly.
 *
 * Core invariant: INSTRUCTION != SUBMISSION != ACCEPTANCE != SETTLEMENT !=
 * RECONCILIATION. Each arrow is a durable, replayable fact.
 *
 * UNKNOWN is critical: after a submit where the network died mid-flight,
 * nobody knows if the provider executed. UNKNOWN must NEVER transition back
 * into SUBMITTING (that can move money twice). It resolves ONLY via
 * provider reconciliation into COMPLETED (found) or QUARANTINED (not found).
 */

export const PAYOUT_STATUSES = [
  'CREATED',
  'ELIGIBLE',
  'RESERVED',
  'VALIDATED',
  'READY',
  'SUBMITTING',
  'SUBMITTED',
  'PROCESSING',
  'COMPLETED',
  'RECONCILED',
  'VALIDATION_FAILED',
  'PROVIDER_REJECTED',
  'RETRYABLE_FAILURE',
  'UNKNOWN',
  'QUARANTINED',
  'CANCELLED',
] as const;

export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

/** Legal transitions. Anything not listed here is an illegal mutation. */
export const LEGAL_TRANSITIONS: Record<PayoutStatus, readonly PayoutStatus[]> = {
  CREATED: ['ELIGIBLE', 'CANCELLED'],
  ELIGIBLE: ['RESERVED', 'CANCELLED'],
  RESERVED: ['VALIDATED', 'CANCELLED'],
  VALIDATED: ['READY', 'VALIDATION_FAILED'],
  READY: ['SUBMITTING', 'CANCELLED'],
  SUBMITTING: ['SUBMITTED', 'PROVIDER_REJECTED', 'RETRYABLE_FAILURE', 'UNKNOWN'],
  SUBMITTED: ['PROCESSING', 'PROVIDER_REJECTED', 'RETRYABLE_FAILURE', 'UNKNOWN'],
  PROCESSING: ['COMPLETED', 'PROVIDER_REJECTED', 'RETRYABLE_FAILURE', 'UNKNOWN'],
  COMPLETED: ['RECONCILED'],
  RECONCILED: [],
  VALIDATION_FAILED: ['QUARANTINED', 'CANCELLED'],
  PROVIDER_REJECTED: ['READY', 'QUARANTINED', 'CANCELLED'], // READY only after root-cause fix + full re-validation
  RETRYABLE_FAILURE: ['READY', 'QUARANTINED', 'CANCELLED'], // retry re-enters through policy validation
  // UNKNOWN resolves ONLY through provider reconciliation — never a blind retry.
  UNKNOWN: ['COMPLETED', 'QUARANTINED'],
  QUARANTINED: [], // human/guardrail review only
  CANCELLED: [],
};

export type TransitionActor = 'system' | 'watchdog' | 'owner' | 'provider';

export interface TransitionInput {
  from: PayoutStatus;
  to: PayoutStatus;
  actor: TransitionActor;
  reason: string;
  expectedVersion: number;
}

export interface TransitionResult {
  ok: boolean;
  from: PayoutStatus;
  to: PayoutStatus;
  newVersion: number;
  reason: string;
  error?: string;
}

/**
 * Validate a transition (pure — persistence is the caller's job: the caller
 * writes Payout.status + PayoutEvent + version bump in ONE transaction).
 */
export function assertTransition(input: TransitionInput): TransitionResult {
  const { from, to, actor, reason, expectedVersion } = input;

  if (!PAYOUT_STATUSES.includes(from)) {
    return {
      ok: false, from, to, newVersion: expectedVersion, reason,
      error: `illegal source status: ${from}`,
    };
  }
  const legal = LEGAL_TRANSITIONS[from];
  if (!legal.includes(to)) {
    return {
      ok: false, from, to, newVersion: expectedVersion, reason,
      error: `illegal transition ${from} -> ${to} (legal: ${legal.join(', ')})`,
    };
  }
  // UNKNOWN is resolved exclusively by provider reconciliation.
  if (from === 'UNKNOWN' && actor !== 'provider' && actor !== 'system') {
    return {
      ok: false, from, to, newVersion: expectedVersion, reason,
      error: 'UNKNOWN resolves only via provider reconciliation',
    };
  }
  // Re-submission from UNKNOWN is not in LEGAL_TRANSITIONS at all, so a
  // blind retry can never pass assertTransition — by construction.
  return { ok: true, from, to, newVersion: expectedVersion + 1, reason };
}

/**
 * Guard for the most dangerous reflex: "the request failed, retry it".
 * UNKNOWN is not a failure verdict — it is "verdict unknown". Retrying an
 * UNKNOWN can duplicate real money movement.
 */
export function isRetrySafe(from: PayoutStatus): boolean {
  // Only statuses whose provider contract guarantees no execution occurred
  // may loop back to READY.
  return from === 'RETRYABLE_FAILURE' || from === 'PROVIDER_REJECTED';
}
