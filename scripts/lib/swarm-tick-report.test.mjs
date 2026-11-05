import { describe, expect, it } from 'vitest';
import {
  JOURNAL_NOTE,
  STUCK_PAYOUT_REDACTED_NOTE,
  buildTickReport,
  phaseEntry,
  redactedAuditDetail,
  summarizePhases,
  tickStamp,
} from './swarm-tick-report.mjs';

describe('swarm tick journal helpers', () => {
  describe('tickStamp', () => {
    // Journal filenames derive from this stamp; [:.] must be folded to '-'
    // exactly as the tick has always done so old consumers keep parsing.
    it('folds ISO colons and dots into filename-safe dashes', () => {
      expect(tickStamp(new Date('2026-11-05T15:41:02.123Z'))).toBe(
        '2026-11-05T15-41-02-123Z',
      );
    });

    it('defaults to the current instant', () => {
      const stamped = tickStamp();
      expect(stamped).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/);
    });
  });

  describe('phaseEntry', () => {
    it('normalizes to the {name,status,tail} journal schema', () => {
      expect(phaseEntry('truth-invariant-audit', 'ok', 'all good')).toEqual({
        name: 'truth-invariant-audit',
        status: 'ok',
        tail: 'all good',
      });
    });

    it('omits tail entirely when there is no detail', () => {
      const entry = phaseEntry('stuck-payout-audit', 'skip_no_db');
      expect(Object.keys(entry)).toEqual(['name', 'status']);
      expect(entry).toEqual({ name: 'stuck-payout-audit', status: 'skip_no_db' });
    });

    it('coerces non-string tails so JSON.stringify never throws', () => {
      expect(phaseEntry('x', 'error', 42).tail).toBe('42');
    });
  });

  describe('redactedAuditDetail', () => {
    // Regression guard for the standing isolation rule: logs/swarm_clickless
    // is autocommitted to this public repo by swarm-tick.yml when
    // AUTOCOMMIT_ENABLE=true, so the journal must never carry raw
    // stuck-payout audit output — only the bare redaction note.
    it('returns the constant redaction note', () => {
      expect(redactedAuditDetail()).toBe(STUCK_PAYOUT_REDACTED_NOTE);
      expect(redactedAuditDetail()).toMatch(/stays in the job log/);
      expect(redactedAuditDetail()).toMatch(/standing isolation rule/);
    });

    it('never echoes caller-supplied raw output into the journal', () => {
      const raw =
        'PAYOUT row 7: beneficiary wallet 0xabc…, amount 12,400.00, memo OWNER-PO-003';
      expect(redactedAuditDetail(raw)).not.toContain('PAYOUT');
      expect(redactedAuditDetail(raw)).not.toContain('0xabc');
      expect(redactedAuditDetail(raw)).toBe(redactedAuditDetail());
    });
  });

  describe('summarizePhases', () => {
    it('counts errors and skips separately from ok phases', () => {
      const phases = [
        { name: 'a', status: 'ok' },
        { name: 'b', status: 'error', tail: 'boom' },
        { name: 'c', status: 'skip_missing' },
        { name: 'd', status: 'skip_no_db' },
        { name: 'e', status: 'ok' },
      ];
      expect(summarizePhases(phases)).toEqual({
        total: 5,
        errors: 1,
        skipped: 2,
        ok: 2,
      });
    });

    it('reports a clean tick as all-ok', () => {
      expect(summarizePhases([{ name: 'a', status: 'ok' }])).toEqual({
        total: 1,
        errors: 0,
        skipped: 0,
        ok: 1,
      });
    });

    it('handles an empty tick without NaN', () => {
      expect(summarizePhases([])).toEqual({
        total: 0,
        errors: 0,
        skipped: 0,
        ok: 0,
      });
    });
  });

  describe('buildTickReport', () => {
    const phases = [
      phaseEntry('truth-invariant-audit', 'ok', 'PASS'),
      phaseEntry('stuck-payout-audit', 'ok', redactedAuditDetail()),
    ];
    const startedAt = Date.parse('2026-11-05T15:40:00.000Z');
    const now = new Date('2026-11-05T15:41:02.123Z');

    it('keeps the read-only doctrine fields hard-coded', () => {
      const report = buildTickReport({ phases, startedAt, now });
      // Money invariants: these two fields must never drift from the doctrine.
      expect(report.readonly).toBe(true);
      expect(report.moved_money).toBe(false);
    });

    it('builds the uid from the start-captured stamp so uid and filename agree', () => {
      const report = buildTickReport({
        phases,
        startedAt,
        now,
        stamp: '2026-11-05T15-40-00-000Z',
      });
      expect(report.uid).toBe('clickless-2026-11-05T15-40-00-000Z');
      expect(report.at).toBe('2026-11-05T15:41:02.123Z');
      expect(report.elapsed_ms).toBe(62_123);
    });

    it('defaults the stamp to the journal instant when none is passed', () => {
      const report = buildTickReport({ phases, startedAt, now });
      expect(report.uid).toBe('clickless-2026-11-05T15-41-02-123Z');
    });

    it('projects only PLAN_TRANSITION_MODE from the environment', () => {
      const withMode = buildTickReport({
        phases,
        startedAt,
        now,
        env: { PLAN_TRANSITION_MODE: '1', DATABASE_URL: 'postgres://secret' },
      });
      expect(withMode.plan_transition_mode).toBe('1');
      expect(JSON.stringify(withMode)).not.toContain('postgres://secret');

      const withoutMode = buildTickReport({ phases, startedAt, now, env: {} });
      expect(withoutMode.plan_transition_mode).toBe('unset');
    });

    it('records phases in order and pins the journal note', () => {
      const report = buildTickReport({ phases, startedAt, now });
      expect(report.phases).toEqual(phases);
      expect(report.note).toBe(JOURNAL_NOTE);
      expect(report.note).toMatch(/No payouts/);
      expect(report.note).toMatch(/status-only/);
    });
  });
});
