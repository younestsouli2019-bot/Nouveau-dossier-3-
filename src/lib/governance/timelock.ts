/**
 * Off-chain timelock for upgrade governance.
 *
 * Why not an EVM contract: the system being protected is Postgres + CI, with
 * no on-chain state. A contract would guard nothing. The enforceable analogue
 * is a proposal record whose execution gate lives in the deploy job.
 */
import { createHash } from 'node:crypto';

export type RiskTier = 'config' | 'workflow' | 'schema' | 'money-path';

export const MIN_DELAY_MS: Record<RiskTier, number> = {
  config: 24 * 60 * 60 * 1000,
  workflow: 48 * 60 * 60 * 1000,
  schema: 72 * 60 * 60 * 1000,
  'money-path': 7 * 24 * 60 * 60 * 1000,
};

export const PROPOSAL_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const EMERGENCY_DELAY_MS = 60 * 60 * 1000;

export interface Approval {
  by: string;
  at: string;
  /** Approval is bound to the exact reviewed diff. */
  diffHash: string;
}

export interface Proposal {
  id: string;
  commit: string;
  diffHash: string;
  riskTier: RiskTier;
  proposedAt: string;
  proposedBy: string;
  quorum: number;
  approvals: Approval[];
  status: 'pending' | 'executed' | 'cancelled';
  /** Emergency path is rollback-only and needs 2x quorum. */
  emergency?: boolean;
  rollbackOf?: string;
  executedAt?: string;
  cancelledAt?: string;
  cancelledBy?: string;
}

export interface Verdict {
  allowed: boolean;
  reasons: string[];
  executeAfter: string;
  remainingMs: number;
  effectiveDelayMs: number;
}

export function proposalDigest(p: Pick<Proposal, 'commit' | 'diffHash' | 'riskTier'>): string {
  return createHash('sha256').update(`${p.commit}:${p.diffHash}:${p.riskTier}`).digest('hex');
}

export function effectiveDelayMs(p: Proposal): number {
  if (p.emergency) return EMERGENCY_DELAY_MS;
  return MIN_DELAY_MS[p.riskTier] ?? MIN_DELAY_MS['money-path'];
}

/** Distinct reviewers other than the proposer, all bound to the same diff. */
export function distinctApprovers(p: Proposal): string[] {
  const proposer = p.proposedBy.trim().toLowerCase();
  const seen = new Set<string>();
  for (const a of p.approvals) {
    const by = a.by.trim().toLowerCase();
    if (!by || by === proposer) continue;
    if (a.diffHash !== p.diffHash) continue;
    seen.add(by);
  }
  return [...seen];
}

export function evaluateProposal(p: Proposal, now: Date = new Date()): Verdict {
  const reasons: string[] = [];
  const delay = effectiveDelayMs(p);
  const proposedAt = Date.parse(p.proposedAt);
  const executeAfterMs = (Number.isFinite(proposedAt) ? proposedAt : now.getTime()) + delay;
  const executeAfter = new Date(executeAfterMs).toISOString();
  const remainingMs = executeAfterMs - now.getTime();

  if (p.status !== 'pending') reasons.push(`proposal status is ${p.status}`);
  if (!Number.isFinite(proposedAt)) reasons.push('proposedAt is not a valid timestamp');
  if (!p.commit || !p.diffHash) reasons.push('commit and diffHash are required');

  if (p.emergency) {
    if (!p.rollbackOf) reasons.push('emergency path is rollback-only: rollbackOf is required');
  }

  if (remainingMs > 0) {
    reasons.push(`timelock not elapsed: ${Math.ceil(remainingMs / 3600000)}h remaining`);
  }
  if (Number.isFinite(proposedAt) && now.getTime() > proposedAt + PROPOSAL_TTL_MS) {
    reasons.push('proposal expired; re-propose against current main');
  }

  const required = p.emergency ? p.quorum * 2 : p.quorum;
  const approvals = distinctApprovers(p);
  if (approvals.length < required) {
    reasons.push(`quorum not met: ${approvals.length}/${required} distinct approvers`);
  }
  if (p.approvals.some((a) => a.diffHash !== p.diffHash)) {
    reasons.push('an approval references a different diff — code changed after review');
  }

  return { allowed: reasons.length === 0, reasons, executeAfter, remainingMs, effectiveDelayMs: delay };
}

export function cancelProposal(p: Proposal, by: string, now: Date = new Date()): Proposal {
  return { ...p, status: 'cancelled', cancelledAt: now.toISOString(), cancelledBy: by };
}
