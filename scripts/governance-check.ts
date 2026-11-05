/**
 * CI gate: exit 0 only when the proposal's timelock, quorum and diff binding
 * all pass. Exit 2 is fail-closed (unreadable/malformed) and must block deploy.
 */
import { readFileSync } from 'node:fs';
import { evaluateProposal, proposalDigest, type Proposal } from '@/lib/governance/timelock';

const file = process.argv[2];
if (!file) {
  console.error('usage: governance-check <proposal.json>');
  process.exit(2);
}

try {
  const proposal = JSON.parse(readFileSync(file, 'utf8')) as Proposal;
  const verdict = evaluateProposal(proposal);
  console.log(JSON.stringify({
    id: proposal.id,
    commit: proposal.commit,
    digest: proposalDigest(proposal),
    ...verdict,
  }, null, 2));
  process.exit(verdict.allowed ? 0 : 1);
} catch (error) {
  console.error('GOVERNANCE FAIL-CLOSED:', (error as Error).message);
  process.exit(2);
}
