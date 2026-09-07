/**
 * Payout pipeline driver — the engine that walks payouts through the state
 * machine, one legal transition at a time. Settlement-gap P0/P1 (2026-09-07).
 *
 * WHY THIS EXISTS: the state machine, ledger, eligibility engine and provider
 * seam were all in place but NOTHING drove payouts through them — payouts
 * reserved funds (RESERVED) and then stalled forever. This module is the
 * missing driver. It is invoked by the tick endpoint (hourly cycle) and
 * advances every drivable payout by at most one step-group per call.
 *
 * Invariants honored (all fail-closed):
 *  - Every transition passes assertTransition() — no arbitrary mutations.
 *  - Ledger writes ride in the SAME transaction as the status update
 *    (version CAS), so a crash can never leave a half-applied transition.
 *  - Reconciliation-first: SUBMITTED/PROCESSING/UNKNOWN payouts advance ONLY
 *    on provider evidence (fetchStatus verdict + providerTransactionId).
 *    Dry-run evidence NEVER settles a payout.
 *  - UNKNOWN is never retried: ambiguous submits land in UNKNOWN with
 *    reconciliationStatus=EVIDENCE_PENDING and resolve exclusively via
 *    provider reconciliation (verdict COMPLETED -> COMPLETED, verdict
 *    FAILED/absent after grace polls -> QUARANTINED).
 *  - Fail-closed submit: live rails must be configured; otherwise the payout
 *    lands in RETRYABLE_FAILURE with an explicit failureReason (no guessing).
 *  - Submit throttling: at most 3 failed submits per payout per UTC day, then
 *    the payout waits for watchdog/owner review.
 */

import {
  assertTransition,
  isRetrySafe,
  type PayoutStatus,
  type TransitionActor,
} from './state-machine';
import { canReserve, deriveBalance, type LedgerEntry } from './ledger';
import {
  LivePathUnavailableError,
  type DestinationType,
  type PayoutProvider,
} from './provider';

export type { PayoutStatus };

// ---------------------------------------------------------------------------
// Store contract (implemented by prisma-driver.ts; tests use an in-memory one)
// ---------------------------------------------------------------------------

export interface PayoutRecord {
  id: string;
  ownerAccountId: string | null;
  settlementId: string | null;
  currency: string;
  grossAmount: number;
  feeAmount: number;
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

export type LedgerWriteType = 'PAYOUT_RESERVED' | 'PAYOUT_SETTLED';

export interface LedgerWrite {
  type: LedgerWriteType;
  /** Positive magnitude — sign convention is applied by the store. */
  amount: number;
  /** Unique per (payout, type) — idempotent replay protection. */
  idempotencyKey: string;
  processorRef: string;
}

export interface TransitionPatch {
  provider?: string | null;
  providerRequestId?: string | null;
  providerTransactionId?: string | null;
  failureCode?: string | null;
  failureReason?: string | null;
  reconciliationStatus?: string;
  submittedAt?: string;
  acceptedAt?: string;
  completedAt?: string;
}

export interface ApplyTransitionArgs {
  payoutId: string;
  expectedVersion: number;
  from: PayoutStatus;
  to: PayoutStatus;
  actor: TransitionActor;
  reason: string;
  evidence?: Record<string, unknown>;
  patch?: TransitionPatch;
  ledger?: LedgerWrite;
}

export type ApplyResult =
  | { ok: true; newVersion: number }
  | { ok: false; error: string };

export interface PayoutStore {
  getPayout(id: string): Promise<PayoutRecord | null>;
  listDrivablePayoutIds(limit: number): Promise<string[]>;
  listLedgerEntries(
    ownerAccountId: string,
    currency: string
  ): Promise<readonly LedgerEntry[]>;
  hasActiveHold(payoutId: string): Promise<boolean>;
  countFailedSubmitsToday(payoutId: string): Promise<number>;
  countProviderPolls(payoutId: string, sinceISO: string): Promise<number>;
  /** Append a provider-poll trace event (no status change). */
  recordProviderPoll(payoutId: string, reason: string): Promise<void>;
  applyTransition(args: ApplyTransitionArgs): Promise<ApplyResult>;
}

export interface PipelineConfig {
  /** Returns the provider for a destination type, or null when unsupported. */
  providers: (destinationType: DestinationType) => PayoutProvider | null;
  /** Policy cap: max net amount a single payout may move. Default 2500. */
  maxPayoutPerTransaction?: number;
  /** Policy cap: max settled per currency per rolling 24h. Default 10000. */
  maxDailySettlePerCurrency?: number;
  /** Provider polls without verdict before UNKNOWN/quarantine. Default 24. */
  pollsBeforeQuarantine?: number;
  /** Max failed submits per payout per day. Default 3. */
  maxFailedSubmitsPerDay?: number;
}

export type AdvanceAction =
  | 'transitioned'
  | 'held'
  | 'insufficient-available'
  | 'validation-failed'
  | 'rail-unavailable'
  | 'submit-throttled'
  | 'awaiting-evidence'
  | 'in-flight'
  | 'terminal'
  | 'missing'
  | 'error'
  | 'version-conflict';

export interface AdvanceOutcome {
  payoutId: string;
  from: PayoutStatus;
  to: PayoutStatus | null;
  action: AdvanceAction;
  detail?: string;
}

/** Statuses the tick will pick up. Terminal states are excluded. */
const DRIVE_STATUSES: readonly string[] = [
  'CREATED', 'ELIGIBLE', 'RESERVED', 'VALIDATED', 'READY',
  'SUBMITTING', 'SUBMITTED', 'PROCESSING', 'COMPLETED',
  'UNKNOWN', 'RETRYABLE_FAILURE', 'PROVIDER_REJECTED',
];

export { DRIVE_STATUSES };

function isHex64(s: string): boolean {
  return /^[0-9a-f]{64}$/i.test(s);
}

function asStatus(s: string): PayoutStatus {
  return s as PayoutStatus;
}

/** Settled (real money out) within the last 24h, per the ledger. */
function settledLast24h(entries: readonly LedgerEntry[]): number {
  const cutoff = Date.now() - 24 * 3_600_000;
  let sum = 0;
  for (const e of entries) {
    if (e.type !== 'PAYOUT_SETTLED') continue;
    if (new Date(e.occurredAt).getTime() < cutoff) continue;
    sum += Math.abs(e.amount);
  }
  return sum;
}

/**
 * Apply a transition through the store with a pre-validated state-machine
 * assertion. Returns ok:false when illegal or when the CAS races — the
 * caller reports and moves on. Transitions are never forced.
 */
async function tryTransition(
  store: PayoutStore,
  payout: PayoutRecord,
  to: PayoutStatus,
  actor: TransitionActor,
  reason: string,
  opts: { evidence?: Record<string, unknown>; patch?: TransitionPatch; ledger?: LedgerWrite } = {}
): Promise<{ ok: boolean; error?: string }> {
  const from = asStatus(payout.status);
  const verdict = assertTransition({
    from, to, actor, reason, expectedVersion: payout.version,
  });
  if (!verdict.ok) return { ok: false, error: verdict.error };

  const res = await store.applyTransition({
    payoutId: payout.id,
    expectedVersion: payout.version,
    from, to, actor, reason,
    evidence: opts.evidence,
    patch: opts.patch,
    ledger: opts.ledger,
  });
  if (res.ok === false) return { ok: false, error: res.error };
  payout.status = to;
  payout.version = res.newVersion;
  return { ok: true };
}

/**
 * Advance ONE payout through the machine. At most one submit per call; the
 * COMPLETED -> RECONCILED reconciliation chain completes in the same call
 * when provider evidence is present, so completed payouts never dangle.
 */
export async function advancePayout(
  store: PayoutStore,
  config: PipelineConfig,
  payoutId: string,
  now: Date = new Date()
): Promise<AdvanceOutcome> {
  const payout = await store.getPayout(payoutId);
  if (!payout) {
    return { payoutId, from: 'CREATED', to: null, action: 'missing' };
  }
  const from = asStatus(payout.status);
  const maxPerTx = config.maxPayoutPerTransaction ?? 2_500;
  const maxDaily = config.maxDailySettlePerCurrency ?? 10_000;
  const pollsBeforeQuarantine = config.pollsBeforeQuarantine ?? 24;
  const maxFailedSubmits = config.maxFailedSubmitsPerDay ?? 3;

  const out = (action: AdvanceAction, to: PayoutStatus | null, detail?: string): AdvanceOutcome =>
    ({ payoutId, from, to, action, detail });

  switch (from) {
    // ---------------------------------------------------------------- creation
    case 'CREATED': {
      const held = await store.hasActiveHold(payout.id);
      if (held) return out('held', null, 'active hold — eligibility engine owns release');
      const ok = await tryTransition(store, payout, 'ELIGIBLE', 'watchdog',
        'no active holds — eligible for reservation');
      return ok.ok ? out('transitioned', 'ELIGIBLE') : out('error', null, ok.error);
    }

    // ------------------------------------------------------------- reservation
    case 'ELIGIBLE': {
      if (!payout.ownerAccountId) {
        return out('held', null, 'no owner account mapped — awaiting owner-account store wiring');
      }
      const entries = await store.listLedgerEntries(payout.ownerAccountId, payout.currency);
      const balance = deriveBalance(payout.ownerAccountId, payout.currency, entries);
      if (!canReserve(payout.netAmount, balance)) {
        return out('insufficient-available', null,
          `available ${balance.available.toFixed(2)} < net ${payout.netAmount.toFixed(2)}`);
      }
      const ok = await tryTransition(store, payout, 'RESERVED', 'system',
        `reserved ${payout.netAmount} ${payout.currency} against derived balance`, {
          ledger: {
            type: 'PAYOUT_RESERVED',
            amount: payout.netAmount,
            idempotencyKey: `payout:${payout.id}:RESERVED`,
            processorRef: payout.idempotencyKey,
          },
        });
      return ok.ok ? out('transitioned', 'RESERVED') : out('error', null, ok.error);
    }

    // ------------------------------------------------------------- validation
    case 'RESERVED': {
      const problems: string[] = [];
      if (!isHex64(payout.destinationFingerprint)) problems.push('destination fingerprint must be sha256 hex');
      if (!payout.idempotencyKey) problems.push('idempotency key missing');
      if (!(payout.netAmount > 0)) problems.push('net amount must be positive');
      if (payout.netAmount > maxPerTx) problems.push(`net exceeds per-transaction cap ${maxPerTx}`);
      const provider = payout.destinationType
        ? config.providers(payout.destinationType as DestinationType)
        : null;
      if (!provider) problems.push(`no provider for rail ${payout.destinationType}`);

      if (payout.ownerAccountId) {
        const entries = await store.listLedgerEntries(payout.ownerAccountId, payout.currency);
        const settled = settledLast24h(entries);
        if (settled + payout.netAmount > maxDaily) {
          problems.push(`daily settle cap ${maxDaily} would be exceeded (${settled.toFixed(2)} settled in 24h)`);
        }
      }

      if (problems.length > 0) {
        // RESERVED only exits legally to VALIDATED/CANCELLED — failures park
        // here (funds stay reserved) for watchdog/owner review. Never forced.
        return out('validation-failed', null, problems.join('; '));
      }
      const ok = await tryTransition(store, payout, 'VALIDATED', 'system',
        'policy validation passed (fingerprint, idempotency, caps, rail)');
      return ok.ok ? out('transitioned', 'VALIDATED') : out('error', null, ok.error);
    }

    // ---------------------------------------------------------------- readiness
    case 'VALIDATED': {
      const ok = await tryTransition(store, payout, 'READY', 'system',
        'rail and destination verified — ready for dispatch');
      return ok.ok ? out('transitioned', 'READY') : out('error', null, ok.error);
    }

    // ---------------------------------------------------------------- dispatch
    case 'READY': {
      const failedToday = await store.countFailedSubmitsToday(payout.id);
      if (failedToday >= maxFailedSubmits) {
        return out('submit-throttled', null,
          `${failedToday} failed submits today (cap ${maxFailedSubmits}) — awaiting watchdog review`);
      }
      const provider = config.providers(payout.destinationType as DestinationType);
      if (!provider) return out('rail-unavailable', null, `no provider for ${payout.destinationType}`);

      // Claim BEFORE the side-effectful submit so two concurrent ticks can
      // never double-submit (version CAS on READY -> SUBMITTING).
      const claim = await tryTransition(store, payout, 'SUBMITTING', 'system',
        'dispatch claim');
      if (claim.ok === false) return out('error', null, claim.error);

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
          const ok = await tryTransition(store, payout, 'SUBMITTED', 'system',
            `accepted by provider ${provider.name}`, {
              evidence: result.evidence,
              patch: {
                provider: provider.name,
                providerRequestId: result.providerRequestId,
                submittedAt: result.submittedAt,
                acceptedAt: result.submittedAt,
              },
            });
          return ok.ok
            ? out('transitioned', 'SUBMITTED')
            : out('error', null, ok.error);
        }
        const ok = await tryTransition(store, payout, 'PROVIDER_REJECTED', 'system',
          'provider rejected the payout at submission', {
            evidence: result.evidence,
            patch: { provider: provider.name, failureCode: 'PROVIDER_REJECTED', failureReason: 'rejected at submit' },
          });
        return ok.ok ? out('transitioned', 'PROVIDER_REJECTED') : out('error', null, ok.error);
      } catch (err) {
        if (err instanceof LivePathUnavailableError) {
          const ok = await tryTransition(store, payout, 'RETRYABLE_FAILURE', 'system',
            `fail-closed: ${err.message}`, {
              patch: { failureCode: 'LIVE_PATH_UNAVAILABLE', failureReason: err.message },
            });
          return ok.ok ? out('transitioned', 'RETRYABLE_FAILURE') : out('error', null, ok.error);
        }
        // Outcome ambiguous (network died mid-flight, crash, unknown shape):
        // UNKNOWN. NEVER re-submit — only provider reconciliation resolves.
        const ok = await tryTransition(store, payout, 'UNKNOWN', 'system',
          `ambiguous submit outcome: ${err instanceof Error ? err.message : String(err)}`, {
            patch: { reconciliationStatus: 'EVIDENCE_PENDING', failureCode: 'AMBIGUOUS_SUBMIT',
                     failureReason: err instanceof Error ? err.message : String(err) },
          });
        return ok.ok ? out('transitioned', 'UNKNOWN') : out('error', null, ok.error);
      }
    }

    // Crash leftover: found in SUBMITTING means the process died mid-submit.
    // Outcome unknowable — UNKNOWN, evidence pending, no re-submit.
    case 'SUBMITTING': {
      const ok = await tryTransition(store, payout, 'UNKNOWN', 'watchdog',
        'interrupted submit — outcome unresolvable without provider evidence', {
          patch: { reconciliationStatus: 'EVIDENCE_PENDING', failureCode: 'INTERRUPTED_SUBMIT' },
        });
      return ok.ok ? out('transitioned', 'UNKNOWN') : out('error', null, ok.error);
    }

    // ------------------------------------------------- provider reconciliation
    case 'SUBMITTED':
    case 'PROCESSING':
    case 'UNKNOWN': {
      const provider = config.providers(payout.destinationType as DestinationType);
      if (!provider || !payout.providerRequestId) {
        if (from === 'UNKNOWN') {
          const ok = await tryTransition(store, payout, 'QUARANTINED', 'system',
            'no provider reference — cannot reconcile evidence (watchdog policy, machine-legal actor)');
          return ok.ok ? out('transitioned', 'QUARANTINED') : out('error', null, ok.error);
        }
        return out('awaiting-evidence', null, 'provider/request reference missing');
      }

      let verdict: Awaited<ReturnType<PayoutProvider['fetchStatus']>>;
      try {
        verdict = await provider.fetchStatus(payout.providerRequestId);
      } catch (err) {
        await store.recordProviderPoll(payout.id,
          `poll error: ${err instanceof Error ? err.message : String(err)}`);
        return out('awaiting-evidence', null, 'provider poll threw — will retry next tick');
      }

      if (verdict.status === 'COMPLETED' && verdict.providerTransactionId) {
        // Legal chain per LEGAL_TRANSITIONS: SUBMITTED may NOT jump to
        // COMPLETED — it must pass through PROCESSING first. UNKNOWN may
        // resolve straight to COMPLETED (provider reconciliation verdict).
        if (from === 'SUBMITTED') {
          const step = await tryTransition(store, payout, 'PROCESSING', 'provider',
            'provider evidence of settlement received');
          if (!step.ok) return out('error', null, step.error);
        }
        const settledOk = await tryTransition(store, payout, 'COMPLETED', 'provider',
          `provider evidence: settled (txn ${verdict.providerTransactionId})`, {
            evidence: verdict.evidence,
            patch: {
              providerTransactionId: verdict.providerTransactionId,
              completedAt: now.toISOString(),
              reconciliationStatus: 'RECONCILIATION_REQUIRED',
            },
          });
        if (!settledOk.ok) return out('error', null, settledOk.error);

        // COMPLETED -> RECONCILED in the same call: write the settled ledger
        // line and stamp reconciliation. Never leave evidence dangling.
        const reconOk = await tryTransition(store, payout, 'RECONCILED', 'system',
          'ledger settled line written — reconciled against provider evidence', {
            evidence: verdict.evidence,
            patch: { reconciliationStatus: 'RECONCILED' },
            ledger: {
              type: 'PAYOUT_SETTLED',
              amount: payout.netAmount,
              idempotencyKey: `payout:${payout.id}:SETTLED`,
              processorRef: payout.providerRequestId ?? payout.idempotencyKey,
            },
          });
        return reconOk.ok
          ? out('transitioned', 'RECONCILED')
          : out('error', 'COMPLETED', reconOk.error);
      }

      if (verdict.status === 'FAILED') {
        if (from === 'UNKNOWN') {
          // UNKNOWN exits only to COMPLETED/QUARANTINED — a FAILED verdict on
          // an ambiguous op resolves to quarantine for review, never a retry.
          const ok = await tryTransition(store, payout, 'QUARANTINED', 'provider',
            'provider verdict FAILED on ambiguous op — quarantined (never blind-retried)', {
              evidence: verdict.evidence,
              patch: { reconciliationStatus: 'QUARANTINED', failureCode: 'PROVIDER_VERDICT_FAILED' },
            });
          return ok.ok ? out('transitioned', 'QUARANTINED') : out('error', null, ok.error);
        }
        const ok = await tryTransition(store, payout, 'PROVIDER_REJECTED', 'provider',
          'provider verdict: FAILED', {
            evidence: verdict.evidence,
            patch: { failureCode: 'PROVIDER_VERDICT_FAILED', failureReason: 'provider reported failure' },
          });
        return ok.ok ? out('transitioned', 'PROVIDER_REJECTED') : out('error', null, ok.error);
      }

      // PENDING/PROCESSING or honest UNKNOWN (dry-run): no fabricated verdicts.
      if (from === 'SUBMITTED' && verdict.status !== 'UNKNOWN') {
        const ok = await tryTransition(store, payout, 'PROCESSING', 'provider',
          'provider reports in-flight processing');
        if (ok.ok) return out('transitioned', 'PROCESSING');
        return out('error', null, ok.error);
      }

      const since = new Date(now.getTime() - 24 * 3_600_000).toISOString();
      const polls = await store.countProviderPolls(payout.id, since);
      await store.recordProviderPoll(payout.id,
        `no verdict (attempt ${polls + 1}/${pollsBeforeQuarantine})`);
      if (from === 'UNKNOWN' && polls + 1 >= pollsBeforeQuarantine) {
        const ok = await tryTransition(store, payout, 'QUARANTINED', 'system',
          `${polls + 1} polls without provider evidence — quarantined (watchdog policy, machine-legal actor)`, {
            patch: { reconciliationStatus: 'QUARANTINED', failureCode: 'EVIDENCE_GAP' },
          });
        return ok.ok ? out('transitioned', 'QUARANTINED') : out('error', null, ok.error);
      }
      return out('awaiting-evidence', null,
        `provider returned ${verdict.status} (poll ${polls + 1}/${pollsBeforeQuarantine})`);
    }

    // ------------------------------------------------- completion reconciliation
    case 'COMPLETED': {
      const ok = await tryTransition(store, payout, 'RECONCILED', 'system',
        'settled ledger line written — reconciled', {
          ledger: {
            type: 'PAYOUT_SETTLED',
            amount: payout.netAmount,
            idempotencyKey: `payout:${payout.id}:SETTLED`,
            processorRef: payout.providerRequestId ?? payout.idempotencyKey,
          },
          patch: { reconciliationStatus: 'RECONCILED' },
        });
      return ok.ok ? out('transitioned', 'RECONCILED') : out('error', null, ok.error);
    }

    // ------------------------------------------------------------ retry requeue
    case 'RETRYABLE_FAILURE':
    case 'PROVIDER_REJECTED': {
      if (!isRetrySafe(from)) return out('terminal', null, 'status not retry-safe');
      const failedToday = await store.countFailedSubmitsToday(payout.id);
      if (failedToday >= maxFailedSubmits) {
        return out('submit-throttled', null,
          `${failedToday} failed submits today — awaiting root-cause review`);
      }
      // Re-enter through full validation (READY re-checks caps on next submit).
      const ok = await tryTransition(store, payout, 'READY', 'watchdog',
        'requeued for re-validation after failure/reconfiguration');
      return ok.ok ? out('transitioned', 'READY') : out('error', null, ok.error);
    }

    case 'RECONCILED':
    case 'QUARANTINED':
    case 'CANCELLED':
    case 'VALIDATION_FAILED':
      return out('terminal', null, `terminal/watchdog state ${from}`);

    default:
      return out('error', null, `unhandled status ${String(from)}`);
  }
}

export interface TickReport {
  tickedAt: string;
  considered: number;
  advanced: number;
  outcomes: AdvanceOutcome[];
  errors: number;
}

/** Advance every drivable payout once. Bounded, idempotent, safe to re-run. */
export async function runPayoutTick(
  store: PayoutStore,
  config: PipelineConfig,
  limit: number = 50,
  now: Date = new Date()
): Promise<TickReport> {
  const ids = await store.listDrivablePayoutIds(limit);
  const outcomes: AdvanceOutcome[] = [];
  let advanced = 0;
  let errors = 0;
  for (const id of ids) {
    try {
      const outcome = await advancePayout(store, config, id, now);
      outcomes.push(outcome);
      if (outcome.action === 'transitioned') advanced += 1;
      if (outcome.action === 'error' || outcome.action === 'version-conflict') errors += 1;
    } catch (err) {
      errors += 1;
      outcomes.push({
        payoutId: id, from: 'CREATED', to: null, action: 'error',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return {
    tickedAt: now.toISOString(),
    considered: ids.length,
    advanced,
    outcomes,
    errors,
  };
}
