// scripts/lib/swarm-tick-report.mjs
// Pure helpers for scripts/swarm-clickless-tick.mjs — phase-entry schema,
// journal redaction, and report assembly.
//
// No side effects, no I/O, no process.env reads: everything is injected so the
// clickless journal is unit-testable and so any consumer (dashboard, audits,
// tests) can build or validate a journal without executing the tick.

/**
 * Journal-safe detail for the host stuck-payout audit: a bare status note.
 *
 * logs/swarm_clickless is autocommitted to this public repo by
 * .github/workflows/swarm-tick.yml when AUTOCOMMIT_ENABLE=true, and the
 * standing isolation rule forbids payout/PII detail outside the job log.
 * This returns a CONSTANT on purpose — raw audit output must never be
 * interpolated into anything that lands in the journal.
 */
export const STUCK_PAYOUT_REDACTED_NOTE =
  '(redacted: full stuck-payout audit output stays in the job log — standing isolation rule)';

/** Standing note embedded in every journal, kept here so tests can pin it. */
export const JOURNAL_NOTE =
  'READ-ONLY reconcile/guard/audit tick. No payouts, no card funding, no ' +
  'delivered flips without a real waybill. Delivered remains gated on a real ' +
  'carrier scan. stuck-payout-audit journal entries are status-only ' +
  '(redacted; full output stays in the job log).';

/**
 * Timestamp used for the tick uid and journal filename.
 * Mirrors the historical format: ISO-8601 with [:.] folded to '-' so the
 * value is filename-safe, e.g. 2026-11-05T15-41-02-123Z.
 */
export function tickStamp(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, '-');
}

/**
 * Normalize a phase result to the journal schema.
 * Every phase entry is { name, status, tail? } — no one-off shapes.
 * `tail` is omitted entirely when undefined (absent means "no detail").
 */
export function phaseEntry(name, status, tail) {
  const entry = { name, status };
  if (tail !== undefined) entry.tail = String(tail);
  return entry;
}

/**
 * Journal-safe detail for the stuck-payout-audit phase.
 * Accepts no trusted input: even if a caller passes raw audit output it is
 * never echoed — the journal only ever records that the phase ran and whether
 * it errored. Full output belongs to the job log, per the isolation rule.
 */
export function redactedAuditDetail() {
  return STUCK_PAYOUT_REDACTED_NOTE;
}

/**
 * Closing-summary counts. Skipped phases are those whose status starts with
 * "skip" (skip_missing / skip_no_db / ...) — expected, non-error states.
 */
export function summarizePhases(phases) {
  const total = phases.length;
  const errors = phases.filter((p) => p.status === 'error').length;
  const skipped = phases.filter(
    (p) => typeof p.status === 'string' && p.status.startsWith('skip'),
  ).length;
  return { total, errors, skipped, ok: total - errors - skipped };
}

/**
 * Assemble the journal report object.
 *
 * @param {object} p
 * @param {Array<{name: string, status: string, tail?: string}>} p.phases
 *        Completed phase entries, in execution order.
 * @param {number} p.startedAt  Tick start epoch-ms (Date.now() captured up top).
 * @param {Date}   [p.now]      Journal instant; defaults to now.
 * @param {object} [p.env]      Environment snapshot; only PLAN_TRANSITION_MODE
 *                              is projected into the journal.
 * @param {string} [p.stamp]    Filename-safe stamp for the uid; defaults to
 *                              tickStamp(now). The tick passes the stamp it
 *                              captured at start so uid and filename always
 *                              agree.
 * @returns {object} Journal payload — readonly/moved_money are hard-coded to
 *                   the read-only doctrine and must never become configurable.
 */
export function buildTickReport({ phases, startedAt, now = new Date(), env = {}, stamp }) {
  return {
    at: now.toISOString(),
    uid: `clickless-${stamp ?? tickStamp(now)}`,
    elapsed_ms: Math.max(0, now.getTime() - startedAt),
    plan_transition_mode: env.PLAN_TRANSITION_MODE ?? 'unset',
    readonly: true,
    moved_money: false,
    phases,
    note: JOURNAL_NOTE,
  };
}
