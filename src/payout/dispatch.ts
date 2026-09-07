/**
 * Payout dispatch — the ONLY path from READY to provider submission.
 * Settlement-gap P2 (2026-09-07).
 *
 * Invariants (owner-mandated):
 *  - Manual approval required: READY is reached only on an owner-actor event
 *    with a non-empty approval signature. No daemon, no cron, no auto-approval.
 *  - Fail-closed: the live gate lives in the provider seam (SWARM_LIVE + full
 *    config or LivePathUnavailableError) — provably nothing is sent, so a
 *    live-path miss is RETRYABLE_FAILURE, never UNKNOWN.
 *  - Ambiguity is UNKNOWN: any non-gate error after the submit call starts is
 *    treated as "may have reached the rail" -> UNKNOWN + RECONCILIATION_REQUIRED.
 *    UNKNOWN is never retried (state-machine construction) — it resolves only
 *    via provider reconciliation (src/payout/reconcile.ts).
 *  - Idempotent: dispatch only from READY. In-flight or settled payouts are
 *    refused, never re-submitted. The idempotencyKey is the provider dedupe.
 *  - Atomic: status + version bump + timestamps + PayoutEvent land in ONE
 *    transaction with optimistic version guarding.
 *  - Fingerprint-only: the raw destination never enters this module.
 */

import type { PayoutProvider, DestinationType } from './provider';
import { getProviderForDestination, LivePathUnavailableError } from './provider';
import { assertTransition, type PayoutStatus } from './state-machine';

/** Structural slice of the Prisma client — write-capable, test-friendly. */
export interface DispatchPayoutRow {
  id: string;
  ownerAccountId: string | null;
  currency: string;
  netAmount: number;
  destinationType: string;
  destinationFingerprint: string;
  idempotencyKey: string;
  status: string;
  provider: string | null;
  providerRequestId: string | null;
  providerTransactionId: string | null;
  reconciliationStatus: string;
  version: number;
}

export interface DispatchPrismaClient {
  payout: {
    findUnique(args?: Record<string, unknown>): Promise<DispatchPayoutRow | null>;
    findMany(args?: Record<string, unknown>): Promise<DispatchPayoutRow[]>;
    updateMany(args: Record<string, unknown>): Promise<{ count: number }>;
  };
  payoutEvent: { create(args: Record<string, unknown>): Promise<unknown> };
  payoutHold: { count(args?: Record<string, unknown>): Promise<number> };
  $transaction<T>(fn: (tx: Omit<DispatchPrismaClient, '$transaction'>) => Promise<T>): Promise<T>;
}

export interface ProviderConfigFromEnv {
  live: boolean;
  liveConfig?: Record<string, string | undefined>;
}

/** Policy layer for liveness — the single place SWARM_LIVE is read for dispatch. */
export function providerConfigFromEnv(env: NodeJS.ProcessEnv): ProviderConfigFromEnv {
  const live = String(env.SWARM_LIVE || 'false').toLowerCase() === 'true';
  if (!live) return { live: false };
  return {
    live: true,
    liveConfig: {
      PAYPAL_API_BASE: env.PAYPAL_API_BASE,
      PAYPAL_CLIENT_ID: env.PAYPAL_CLIENT_ID,
      PAYPAL_CLIENT_SECRET: env.PAYPAL_CLIENT_SECRET,
      BANK_API_BASE: env.LIVE_BANK_API,
      BANK_API_KEY: env.LIVE_BANK_API_KEY,
      CRYPTO_SIGNING_POLICY: env.CRYPTO_SIGNING_POLICY,
      CRYPTO_HOT_WALLET_REF: env.CRYPTO_HOT_WALLET_REF,
    },
  };
}

export interface DispatchDeps {
  prisma: DispatchPrismaClient;
  providerFor?: (destinationType: DestinationType, config: ProviderConfigFromEnv) => PayoutProvider;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

/** One atomic, optimistic-versioned transition + its PayoutEvent. */
export async function atomicTransition(
  prisma: DispatchPrismaClient,
  input: {
    payoutId: string;
    from: PayoutStatus;
    to: PayoutStatus;
    actor: 'system' | 'watchdog' | 'owner' | 'provider';
    reason: string;
    expectedVersion: number;
    data?: Record<string, unknown>;
    evidence?: Record<string, unknown>;
  }
): Promise<{ ok: true; newVersion: number } | { ok: false; error: string }> {
  const check = assertTransition({
    from: input.from,
    to: input.to,
    actor: input.actor,
    reason: input.reason,
    expectedVersion: input.expectedVersion,
  });
  if (check.ok === false) return { ok: false, error: check.error || 'illegal transition' };

  const updated = await prisma.$transaction(async (tx) => {
    const res = await tx.payout.updateMany({
      where: { id: input.payoutId, status: input.from, version: input.expectedVersion },
      data: {
        status: input.to,
        version: input.expectedVersion + 1,
        ...input.data,
      },
    });
    if (res.count !== 1) return null; // version/status race — concurrent writer won
    await tx.payoutEvent.create({
      data: {
        payoutId: input.payoutId,
        fromStatus: input.from,
        toStatus: input.to,
        actor: input.actor,
        reason: input.reason,
        ...(input.evidence ? { evidence: input.evidence } : {}),
      },
    });
    return { count: res.count };
  });
  if (!updated) {
    return {
      ok: false,
      error: `concurrent write detected (payout ${input.payoutId} changed during transition ${input.from}->${input.to})`,
    };
  }
  return { ok: true, newVersion: input.expectedVersion + 1 };
}

const FINGERPRINT_RE = /^[0-9a-f]{64}$/i;

export type PrepareResult =
  | { ok: true; payoutId: string; status: 'READY'; version: number }
  | { ok: false; error: string };

/**
 * RESERVED -> VALIDATED -> READY.
 * The owner approval signature is REQUIRED before any transition happens —
 * a payout without explicit manual approval never leaves RESERVED.
 */
export async function preparePayout(
  payoutId: string,
  approval: { approvedBy: string; approvalReason: string },
  deps: DispatchDeps
): Promise<PrepareResult> {
  if (!approval.approvedBy || !approval.approvedBy.trim()) {
    return { ok: false, error: 'manual approval required: approvedBy must name the approving owner (fail-closed)' };
  }
  const payout = await deps.prisma.payout.findUnique({ where: { id: payoutId } });
  if (!payout) return { ok: false, error: `payout ${payoutId} not found` };
  if (payout.status !== 'RESERVED') {
    return { ok: false, error: `prepare only from RESERVED (current: ${payout.status})` };
  }
  if (!FINGERPRINT_RE.test(payout.destinationFingerprint)) {
    return { ok: false, error: 'pre-flight failed: destination fingerprint missing/malformed — refusing to validate' };
  }
  if (!(payout.netAmount > 0)) {
    return { ok: false, error: 'pre-flight failed: netAmount must be > 0' };
  }
  const activeHolds = await deps.prisma.payoutHold.count({
    where: { payoutId, releasedAt: null },
  });
  if (activeHolds > 0) {
    return { ok: false, error: `pre-flight failed: ${activeHolds} active hold(s) — release/clear them first (eligibility engine)` };
  }

  let version = payout.version;

  const validated = await atomicTransition(deps.prisma, {
    payoutId,
    from: 'RESERVED',
    to: 'VALIDATED',
    actor: 'system',
    reason: 'pre-flight passed: fingerprint, amount, holds verified',
    expectedVersion: version,
  });
  if (validated.ok === false) return { ok: false, error: validated.error };
  version = validated.newVersion;

  const readied = await atomicTransition(deps.prisma, {
    payoutId,
    from: 'VALIDATED',
    to: 'READY',
    actor: 'owner',
    reason: `manual approval: ${approval.approvedBy} — ${approval.approvalReason}`,
    expectedVersion: version,
  });
  if (readied.ok === false) return { ok: false, error: readied.error };

  return { ok: true, payoutId, status: 'READY', version: readied.newVersion };
}

export type DispatchResult =
  | { ok: true; payoutId: string; status: 'SUBMITTED'; providerRequestId: string }
  | { ok: false; error: string; status?: string };

/**
 * READY -> SUBMITTING -> SUBMITTED | PROVIDER_REJECTED | RETRYABLE_FAILURE | UNKNOWN.
 * Manual invocation only — there is no daemon and no cron wired to this call.
 */
export async function dispatchPayout(payoutId: string, deps: DispatchDeps): Promise<DispatchResult> {
  const payout = await deps.prisma.payout.findUnique({ where: { id: payoutId } });
  if (!payout) return { ok: false, error: `payout ${payoutId} not found` };
  if (payout.status !== 'READY') {
    const inFlight = ['SUBMITTING', 'SUBMITTED', 'PROCESSING', 'COMPLETED', 'RECONCILED'];
    if (inFlight.includes(payout.status)) {
      return {
        ok: false,
        status: payout.status,
        error: `idempotent dispatch: payout already ${payout.status} — in-flight/settled payouts are never re-submitted`,
      };
    }
    return { ok: false, status: payout.status, error: `dispatch only from READY (current: ${payout.status})` };
  }

  const env = deps.env ?? process.env;
  const config = providerConfigFromEnv(env);
  const providerFor =
    deps.providerFor ??
    ((dt: DestinationType, cfg: ProviderConfigFromEnv) => getProviderForDestination(dt, cfg));
  const provider = providerFor(payout.destinationType as DestinationType, config);
  const now = deps.now ?? (() => new Date());

  const began = await atomicTransition(deps.prisma, {
    payoutId,
    from: 'READY',
    to: 'SUBMITTING',
    actor: 'system',
    reason: `dispatch begin via ${provider.name} (manual invocation)`,
    expectedVersion: payout.version,
  });
  if (began.ok === false) return { ok: false, status: 'READY', error: began.error };

  try {
    const result = await provider.submit({
      payoutId: payout.id,
      idempotencyKey: payout.idempotencyKey,
      currency: payout.currency,
      netAmount: payout.netAmount,
      destinationType: payout.destinationType as DestinationType,
      destinationFingerprint: payout.destinationFingerprint,
    });
    if (result.status === 'SUBMITTED') {
      const done = await atomicTransition(deps.prisma, {
        payoutId,
        from: 'SUBMITTING',
        to: 'SUBMITTED',
        actor: 'provider',
        reason: `${provider.name} accepted instruction (provider request ${result.providerRequestId})`,
        expectedVersion: began.newVersion,
        data: {
          provider: provider.name,
          providerRequestId: result.providerRequestId,
          submittedAt: now(),
          reconciliationStatus: 'PENDING',
        },
        evidence: result.evidence,
      });
      if (done.ok === false) return { ok: false, status: 'SUBMITTING', error: done.error };
      return { ok: true, payoutId, status: 'SUBMITTED', providerRequestId: result.providerRequestId };
    }
    // REJECTED before/at the rail — provably no execution.
    const rejected = await atomicTransition(deps.prisma, {
      payoutId,
      from: 'SUBMITTING',
      to: 'PROVIDER_REJECTED',
      actor: 'provider',
      reason: `${provider.name} rejected instruction`,
      expectedVersion: began.newVersion,
      data: {
        provider: provider.name,
        failureCode: 'PROVIDER_REJECTED',
        failureReason: 'provider rejected the instruction at submission',
        failedAt: now(),
      },
      evidence: result.evidence,
    });
    if (rejected.ok === false) return { ok: false, status: 'SUBMITTING', error: rejected.error };
    return {
      ok: false,
      status: 'PROVIDER_REJECTED',
      error: 'provider rejected the instruction (re-enter via READY only after root-cause fix + re-validation)',
    };
  } catch (err) {
    if (err instanceof LivePathUnavailableError) {
      // The live gate fired BEFORE any rail call — provably nothing was sent.
      const retryable = await atomicTransition(deps.prisma, {
        payoutId,
        from: 'SUBMITTING',
        to: 'RETRYABLE_FAILURE',
        actor: 'system',
        reason: `live path unavailable (nothing sent): ${err.reason}`,
        expectedVersion: began.newVersion,
        data: {
          failureCode: 'LIVE_PATH_UNAVAILABLE',
          failureReason: err.message,
          failedAt: now(),
        },
      });
      if (retryable.ok === false) return { ok: false, status: 'SUBMITTING', error: retryable.error };
      return { ok: false, status: 'RETRYABLE_FAILURE', error: 'live path unavailable — nothing was sent (fail-closed)' };
    }
    // Ambiguous: the instruction MAY have reached the rail. NEVER retry.
    const unknown = await atomicTransition(deps.prisma, {
      payoutId,
      from: 'SUBMITTING',
      to: 'UNKNOWN',
      actor: 'system',
      reason: `ambiguous submit outcome (may have reached the rail): ${err instanceof Error ? err.message : String(err)}`,
      expectedVersion: began.newVersion,
      data: {
        provider: provider.name,
        failureCode: 'SUBMIT_AMBIGUOUS',
        failureReason: err instanceof Error ? err.message : String(err),
        failedAt: now(),
        reconciliationStatus: 'RECONCILIATION_REQUIRED',
      },
    });
    if (unknown.ok === false) return { ok: false, status: 'SUBMITTING', error: unknown.error };
    return {
      ok: false,
      status: 'UNKNOWN',
      error: 'submit outcome ambiguous — payout is UNKNOWN and will resolve ONLY via provider reconciliation (no retry)',
    };
  }
}
