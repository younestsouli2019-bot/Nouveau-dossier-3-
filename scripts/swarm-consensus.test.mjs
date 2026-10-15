import { describe, expect, it } from 'vitest';
import { evaluateQuorum, MIN_DISTINCT_VOTERS, PROPOSAL_TYPES } from './swarm-consensus.mjs';

const OVERRIDE = PROPOSAL_TYPES.MONEY_MOVING_BLOCKED_OVERRIDE;
const HOLIDAY = PROPOSAL_TYPES.HOLIDAY_NON_ESSENTIALS;

let clock = 0;
const at = () => clock;

function ballot(voter, inFavor, { weight = 1, offsetMs = 0 } = {}) {
  return { voter, weight, inFavor, at: at() - offsetMs };
}

describe('swarm consensus quorum', () => {
  describe('one voter cannot carry a proposal', () => {
    // Regression: on 2026-09-29 the live data/swarm_autonomy/votes held 19
    // MONEY_MOVING_BLOCKED_OVERRIDE ballots, all written by the single voter
    // `swarm-improve-loop`. The old tally checked `yN >= 2` against a raw
    // ballot count, so the override reported passes:true and carried weight
    // 19x. Quorum has to count distinct people, not copies.
    it('rejects 19 identical ballots from one voter (the real recorded case)', () => {
      const ballots = Array.from({ length: 19 }, (_, i) =>
        ballot('swarm-improve-loop', true, { weight: 1, offsetMs: i }),
      );

      const r = evaluateQuorum(ballots, OVERRIDE, { now: at() });

      expect(r.distinctVoters).toBe(1);
      expect(r.yesVoters).toBe(1);
      expect(r.duplicateBallotsIgnored).toBe(18);
      expect(r.passes).toBe(false);
      expect(r.failsBecause?.join(' ')).toMatch(/1 distinct voter\(s\); 2 required/);
    });

    it('does not inflate a lone voter weight by repetition', () => {
      const many = Array.from({ length: 19 }, () => ballot('swarm-improve-loop', true, { weight: 1 }));
      const one = [ballot('swarm-improve-loop', true, { weight: 1 })];

      const rMany = evaluateQuorum(many, OVERRIDE, { now: at() });
      const rOne = evaluateQuorum(one, OVERRIDE, { now: at() });

      // Weight is a property of the voter, so repeating the vote must not
      // change the arithmetic at all.
      expect(rMany.yesWeighted).toBe(rOne.yesWeighted);
      expect(rMany.approvalPct).toBe(rOne.approvalPct);
    });

    it('rejects one voter even when unanimously in favour and unopposed', () => {
      const r = evaluateQuorum([ballot('final-master-audit', true, { weight: 3 })], OVERRIDE, {
        now: at(),
      });
      expect(r.approvalPct).toBe(1);
      expect(r.passes).toBe(false);
    });

    it('rejects a repeat voter whose later ballot is a NO', () => {
      const yes = ballot('swarm-improve-loop', true, { offsetMs: 60_000 });
      const no = ballot('swarm-improve-loop', false, { offsetMs: 0 });
      const r = evaluateQuorum([yes, no], HOLIDAY, { now: at() });
      // Latest position wins, and one voter is still one voter.
      expect(r.yesCount).toBe(0);
      expect(r.noCount).toBe(1);
      expect(r.passes).toBe(false);
    });
  });

  describe('genuine multi-voter quorum still works', () => {
    it('passes with two distinct voters above the approval threshold', () => {
      const r = evaluateQuorum(
        [ballot('final-master-audit', true, { weight: 3 }), ballot('swarm-autonomy', true, { weight: 2 })],
        OVERRIDE,
        { now: at() },
      );
      expect(r.distinctVoters).toBe(2);
      expect(r.yesVoters).toBe(2);
      expect(r.approvalPct).toBe(1);
      expect(r.passes).toBe(true);
      expect(r.failsBecause).toBeNull();
    });

    it('fails when the approval percentage is below quorum', () => {
      const r = evaluateQuorum(
        [
          ballot('final-master-audit', true, { weight: 3 }),
          ballot('swarm-autonomy', false, { weight: 2 }),
        ],
        OVERRIDE,
        { now: at() },
      );
      expect(r.distinctVoters).toBe(2);
      expect(r.passes).toBe(false);
      expect(r.failsBecause?.join(' ')).toMatch(/approval 60\.0% < quorum 85\.0%/);
    });

    it('requires distinct voters even when weight is plentiful', () => {
      // Weight 3 alone cannot substitute for a second person.
      const r = evaluateQuorum(
        [ballot('final-master-audit', true, { weight: 3 }), ballot('swarm-autonomy', false, { weight: 2 })],
        { ...HOLIDAY, quorumPct: 0.5, requiresWeight: true },
        { now: at() },
      );
      expect(r.approvalPct).toBe(0.6);
      expect(r.passes).toBe(false);
    });
  });

  describe('degenerate input', () => {
    it('fails on an empty ballot set', () => {
      const r = evaluateQuorum([], OVERRIDE, { now: at() });
      expect(r.passes).toBe(false);
      expect(r.approvalPct).toBe(0);
    });

    it('does not let a missing voter field count as a distinct voter', () => {
      const r = evaluateQuorum(
        [{ weight: 3, inFavor: true, at: at() }, { weight: 3, inFavor: true, at: at() }],
        OVERRIDE,
        { now: at() },
      );
      // Both collapse onto the empty-string key, so this is one voter.
      expect(r.distinctVoters).toBe(1);
      expect(r.passes).toBe(false);
    });
  });

  it('exposes a minimum-voter constant of 2', () => {
    expect(MIN_DISTINCT_VOTERS).toBe(2);
  });
});
