import { describe, expect, it } from 'vitest';
import {
  evaluateProposal, proposalDigest, distinctApprovers, cancelProposal,
  type Proposal, type RiskTier,
} from '@/lib/governance/timelock';

const NOW = new Date('2026-11-05T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600000).toISOString();

function make(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: 'p1',
    commit: 'abc123',
    diffHash: 'sha256:aaa',
    riskTier: 'config' as RiskTier,
    proposedAt: hoursAgo(25),
    proposedBy: 'owner',
    quorum: 2,
    approvals: [
      { by: 'critic', at: hoursAgo(20), diffHash: 'sha256:aaa' },
      { by: 'supervisor', at: hoursAgo(19), diffHash: 'sha256:aaa' },
    ],
    status: 'pending',
    ...overrides,
  };
}

describe('timelock', () => {
  it('allows a config change after 24h with quorum', () => {
    expect(evaluateProposal(make(), NOW).allowed).toBe(true);
  });

  it('blocks before the delay elapses and reports remaining time', () => {
    const v = evaluateProposal(make({ proposedAt: hoursAgo(23) }), NOW);
    expect(v.allowed).toBe(false);
    expect(v.reasons.join(' ')).toContain('timelock not elapsed');
  });

  it('does not count the proposer self-approving', () => {
    const v = evaluateProposal(make({
      proposedBy: 'owner',
      approvals: [
        { by: 'OWNER', at: hoursAgo(20), diffHash: 'sha256:aaa' },
        { by: 'critic', at: hoursAgo(19), diffHash: 'sha256:aaa' },
      ],
    }), NOW);
    expect(v.allowed).toBe(false);
    expect(v.reasons.join(' ')).toContain('quorum not met: 1/2');
  });

  it('invalidates approvals bound to a different diff', () => {
    const v = evaluateProposal(make({
      approvals: [
        { by: 'critic', at: hoursAgo(20), diffHash: 'sha256:old' },
        { by: 'supervisor', at: hoursAgo(19), diffHash: 'sha256:aaa' },
      ],
    }), NOW);
    expect(v.allowed).toBe(false);
    expect(v.reasons.join(' ')).toContain('different diff');
  });

  it('counts a repeated approver once', () => {
    const p = make({
      approvals: [
        { by: 'critic', at: hoursAgo(20), diffHash: 'sha256:aaa' },
        { by: 'Critic', at: hoursAgo(19), diffHash: 'sha256:aaa' },
      ],
    });
    expect(distinctApprovers(p)).toHaveLength(1);
    expect(evaluateProposal(p, NOW).allowed).toBe(false);
  });

  it('enforces the 7-day money-path delay', () => {
    const six = evaluateProposal(make({ riskTier: 'money-path', proposedAt: hoursAgo(144) }), NOW);
    const eight = evaluateProposal(make({ riskTier: 'money-path', proposedAt: hoursAgo(192) }), NOW);
    expect(six.allowed).toBe(false);
    expect(eight.allowed).toBe(true);
  });

  it('rejects an expired proposal', () => {
    const v = evaluateProposal(make({ proposedAt: hoursAgo(24 * 15) }), NOW);
    expect(v.allowed).toBe(false);
    expect(v.reasons.join(' ')).toContain('expired');
  });

  it('rejects a cancelled proposal', () => {
    const cancelled = cancelProposal(make(), 'critic', NOW);
    expect(evaluateProposal(cancelled, NOW).allowed).toBe(false);
  });

  it('refuses the emergency path without a rollback target', () => {
    const v = evaluateProposal(make({ emergency: true, proposedAt: hoursAgo(2) }), NOW);
    expect(v.allowed).toBe(false);
    expect(v.reasons.join(' ')).toContain('rollback-only');
  });

  it('allows an emergency rollback after 1h with double quorum', () => {
    const v = evaluateProposal(make({
      emergency: true,
      rollbackOf: 'deadbeef',
      proposedAt: hoursAgo(2),
      approvals: [
        { by: 'critic', at: hoursAgo(1.5), diffHash: 'sha256:aaa' },
        { by: 'supervisor', at: hoursAgo(1.4), diffHash: 'sha256:aaa' },
        { by: 'auditor', at: hoursAgo(1.3), diffHash: 'sha256:aaa' },
        { by: 'custodian', at: hoursAgo(1.2), diffHash: 'sha256:aaa' },
      ],
    }), NOW);
    expect(v.allowed).toBe(true);
  });

  it('binds the digest to commit, diff and risk tier', () => {
    const a = proposalDigest({ commit: 'c1', diffHash: 'd1', riskTier: 'config' });
    expect(a).toHaveLength(64);
    expect(a).not.toBe(proposalDigest({ commit: 'c1', diffHash: 'd1', riskTier: 'schema' }));
    expect(a).not.toBe(proposalDigest({ commit: 'c2', diffHash: 'd1', riskTier: 'config' }));
  });
});
