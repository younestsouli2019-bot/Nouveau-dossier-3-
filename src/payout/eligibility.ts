/**
 * Eligibility engine — "held forever" becomes structurally impossible.
 *
 * Settlement-gap P0 (2026-09-07). Every held amount carries a reason, a
 * creation time, a next review time, and optionally an expiry. The Treasury
 * Watchdog polls nextReviewAt and requeues anything stale, so no amount can
 * silently rot.
 */

export const HOLD_REASONS = [
  'HELD_PENDING_RECONCILIATION',
  'HELD_PENDING_PROVIDER_CONFIRMATION',
  'HELD_PENDING_OWNER_VERIFICATION',
  'HELD_POLICY_REVIEW',
  'HELD_MINIMUM_THRESHOLD',
  'HELD_CURRENCY_CONVERSION',
  'HELD_PAYMENT_RAIL_UNAVAILABLE',
] as const;

export type HoldReason = (typeof HOLD_REASONS)[number];

export interface HoldRecord {
  payoutId: string;
  holdReason: HoldReason;
  createdAt: string; // ISO 8601
  nextReviewAt: string; // ISO 8601
  expiresAt?: string;
  releasedAt?: string;
}

export interface StaleHold {
  payoutId: string;
  holdReason: HoldReason;
  heldForHours: number;
  nextReviewAt: string;
}

/** Hours after which a hold with an unchanged reason is considered stale. */
export const STALE_HOLD_HOURS = 72;

export function isStale(hold: HoldRecord, now: Date): boolean {
  if (hold.releasedAt) return false;
  const created = new Date(hold.createdAt).getTime();
  if (Number.isNaN(created)) return false;
  const heldForHours = (now.getTime() - created) / 3_600_000;
  const expired = hold.expiresAt
    ? now.getTime() > new Date(hold.expiresAt).getTime()
    : false;
  return heldForHours >= STALE_HOLD_HOURS || expired;
}

export function describeStaleHold(hold: HoldRecord, now: Date): StaleHold {
  const created = new Date(hold.createdAt).getTime();
  return {
    payoutId: hold.payoutId,
    holdReason: hold.holdReason,
    heldForHours: Math.round(((now.getTime() - created) / 3_600_000) * 10) / 10,
    nextReviewAt: hold.nextReviewAt,
  };
}
