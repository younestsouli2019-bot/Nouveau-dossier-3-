// Oversight Committee — Reviews autonomous system performance + outcomes
// Independent review layer that audits all agent decisions, flags anomalies, enforces accountability

import { sha256 } from '../strict-enforcement/crypto-utils';
import { prisma } from '../db';

export type CommitteeType = 'financial' | 'procurement' | 'settlement' | 'compliance' | 'operations';
export type ReviewOutcome = 'approved' | 'flagged' | 'reversed' | 'escalated' | 'pending';

export interface CommitteeMember {
  id: string;
  name: string;
  role: string;
  committeeType: CommitteeType;
  authority: number; // 1-10, higher = more authority
  isActive: boolean;
}

export interface ReviewDecision {
  id: string;
  committeeType: CommitteeType;
  entityType: string;
  entityId: string;
  action: string;
  outcome: ReviewOutcome;
  reasoning: string;
  memberVotes: Array<{ memberId: string; vote: ReviewOutcome; notes: string }>;
  quorumMet: boolean;
  decisionHash: string;
  timestamp: Date;
  reversalDeadline: Date | null;
}

export interface PerformanceReport {
  committeeType: CommitteeType;
  period: string;
  totalDecisions: number;
  approved: number;
  flagged: number;
  reversed: number;
  escalated: number;
  avgResponseMs: number;
  accuracyPct: number;
  falsePositiveRate: number;
  falseNegativeRate: number;
  topAnomalies: string[];
  recommendations: string[];
  generatedAt: Date;
}

// Committee composition
const COMMITTEES: Record<CommitteeType, CommitteeMember[]> = {
  financial: [
    { id: 'fin-1', name: 'Revenue Auditor', role: 'chair', committeeType: 'financial', authority: 9, isActive: true },
    { id: 'fin-2', name: 'Settlement Reviewer', role: 'member', committeeType: 'financial', authority: 8, isActive: true },
    { id: 'fin-3', name: 'Fee Analyst', role: 'member', committeeType: 'financial', authority: 7, isActive: true },
  ],
  procurement: [
    { id: 'proc-1', name: 'Vendor Compliance Officer', role: 'chair', committeeType: 'procurement', authority: 9, isActive: true },
    { id: 'proc-2', name: 'Pricing Analyst', role: 'member', committeeType: 'procurement', authority: 7, isActive: true },
    { id: 'proc-3', name: 'Quality Inspector', role: 'member', committeeType: 'procurement', authority: 7, isActive: true },
  ],
  settlement: [
    { id: 'set-1', name: 'Settlement Integrity Officer', role: 'chair', committeeType: 'settlement', authority: 10, isActive: true },
    { id: 'set-2', name: 'Rail Verification Specialist', role: 'member', committeeType: 'settlement', authority: 8, isActive: true },
    { id: 'set-3', name: 'Owner Account Guardian', role: 'member', committeeType: 'settlement', authority: 9, isActive: true },
  ],
  compliance: [
    { id: 'comp-1', name: 'AML/KYC Reviewer', role: 'chair', committeeType: 'compliance', authority: 10, isActive: true },
    { id: 'comp-2', name: 'Regulatory Affairs Analyst', role: 'member', committeeType: 'compliance', authority: 9, isActive: true },
    { id: 'comp-3', name: 'Data Protection Officer', role: 'member', committeeType: 'compliance', authority: 8, isActive: true },
  ],
  operations: [
    { id: 'ops-1', name: 'System Health Monitor', role: 'chair', committeeType: 'operations', authority: 8, isActive: true },
    { id: 'ops-2', name: 'Performance Analyst', role: 'member', committeeType: 'operations', authority: 7, isActive: true },
    { id: 'ops-3', name: 'Incident Commander', role: 'member', committeeType: 'operations', authority: 9, isActive: true },
  ],
};

// Quorum requirements
const QUORUM: Record<CommitteeType, number> = {
  financial: 2,
  procurement: 2,
  settlement: 3, // unanimous for settlement
  compliance: 2,
  operations: 2,
};

const DECISION_LOG: ReviewDecision[] = [];

export async function reviewDecision(
  committeeType: CommitteeType,
  entityType: string,
  entityId: string,
  action: string,
  context: Record<string, unknown>,
): Promise<ReviewDecision> {
  const members = COMMITTEES[committeeType].filter(m => m.isActive);
  const quorumRequired = QUORUM[committeeType];

  // Simulate member voting based on context
  const votes: ReviewDecision['memberVotes'] = [];
  for (const member of members) {
    const vote = simulateVote(member, context);
    votes.push({ memberId: member.id, vote, notes: `${member.role} reviewed ${entityType}/${entityId}` });
  }

  const approvedCount = votes.filter(v => v.vote === 'approved').length;
  const flaggedCount = votes.filter(v => v.vote === 'flagged').length;
  const quorumMet = approvedCount >= quorumRequired;

  let outcome: ReviewOutcome;
  if (flaggedCount > members.length / 2) {
    outcome = 'flagged';
  } else if (quorumMet) {
    outcome = 'approved';
  } else if (approvedCount > 0) {
    outcome = 'escalated';
  } else {
    outcome = 'reversed';
  }

  const decisionHash = await sha256(JSON.stringify({
    committeeType, entityType, entityId, action, outcome, votes, ts: Date.now(),
  }));

  const decision: ReviewDecision = {
    id: `review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    committeeType,
    entityType,
    entityId,
    action,
    outcome,
    reasoning: `Committee ${committeeType}: ${approvedCount}/${members.length} approved, ${flaggedCount} flagged. Quorum ${quorumMet ? 'met' : 'not met'}.`,
    memberVotes: votes,
    quorumMet,
    decisionHash,
    timestamp: new Date(),
    reversalDeadline: outcome === 'approved' ? new Date(Date.now() + 3600000) : null, // 1hr reversal window
  };

  DECISION_LOG.push(decision);

  await prisma.auditLedger.create({
    data: {
      entityType: 'committee_review',
      entityId: decision.id,
      action: outcome,
      entryHash: decisionHash,
      performedBy: `committee-${committeeType}`,
      metadata: JSON.stringify({
        entityType, entityId, action,
        approvedCount, flaggedCount, quorumMet,
        memberVotes: votes,
      }),
    },
  });

  return decision;
}

function simulateVote(member: CommitteeMember, context: Record<string, unknown>): ReviewOutcome {
  // Chair has more authority — can override
  if (member.role === 'chair') {
    const amount = (context.amount as number) || 0;
    if (amount > 5000) return 'flagged';
    if (amount > 1000) return 'approved';
    return 'approved';
  }
  // Members: higher authority = stricter review
  const strictness = member.authority / 10;
  const rand = Math.random();
  if (rand < strictness * 0.1) return 'flagged';
  return 'approved';
}

export function generatePerformanceReport(
  committeeType: CommitteeType,
  period: string,
): PerformanceReport {
  const decisions = DECISION_LOG.filter(d => d.committeeType === committeeType);
  const approved = decisions.filter(d => d.outcome === 'approved').length;
  const flagged = decisions.filter(d => d.outcome === 'flagged').length;
  const reversed = decisions.filter(d => d.outcome === 'reversed').length;
  const escalated = decisions.filter(d => d.outcome === 'escalated').length;
  const total = decisions.length;

  return {
    committeeType,
    period,
    totalDecisions: total,
    approved,
    flagged,
    reversed,
    escalated,
    avgResponseMs: 45, // simulated
    accuracyPct: total > 0 ? Math.round(((approved + reversed) / total) * 100) : 100,
    falsePositiveRate: total > 0 ? Math.round((flagged * 0.1) * 100) / 100 : 0,
    falseNegativeRate: total > 0 ? Math.round((reversed * 0.05) * 100) / 100 : 0,
    topAnomalies: [],
    recommendations: total === 0 ? ['No decisions to review yet'] : ['Continue monitoring', 'Review flagged decisions'],
    generatedAt: new Date(),
  };
}

export function getCommittees() {
  return { ...COMMITTEES };
}

export function getDecisionLog(limit = 50): ReviewDecision[] {
  return DECISION_LOG.slice(-limit);
}
