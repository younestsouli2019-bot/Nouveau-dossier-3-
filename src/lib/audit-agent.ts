// LLM Audit Agent — Prompt Engineering for Cannibalistic Duplicate Detection
// Trains the audit agent to detect and isolate out-of-control duplicates
// Attack vector: State Duplication — clones processing identical states
// Prevention: LLM-powered pattern recognition + cryptographic isolation

import { sha256 } from './strict-enforcement/crypto-utils';

export interface AuditPrompt {
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  maxTokens: number;
}

export interface DuplicateDetection {
  isDuplicate: boolean;
  confidence: number;
  pattern: string;
  isolationAction: 'quarantine' | 'flag' | 'allow' | 'escalate';
  reasoning: string;
  proofHash: string;
}

// System prompt — the audit agent's core instructions
const AUDIT_SYSTEM_PROMPT = `You are a financial audit agent specialized in detecting cannibalistic duplicate transactions.

Your job is to identify when the same financial event has been processed multiple times (cloned/duplicated) and flag it for isolation.

RULES:
1. Two transactions are DUPLICATES if they share ≥3 of: same amount, same source, same destination, same timestamp (±1h), same currency
2. CANNIBALISTIC if duplicates are competing for the same funds (both trying to settle the same obligation)
3. FABRICATED if the "proof" field contains plaintext concatenation instead of a real SHA-256 hash
4. FABRICATED proof pattern: "sha256_" prefix followed by human-readable text (emails, names, timestamps) instead of 64 hex chars
5. STUCK if a settlement has been IN_TRANSIT for >48 hours without resolution
6. MISROUTED if crypto settlement destination doesn't match the owner's canonical wallet
7. FRAUD if state machine transitions are violated (delivered before shipped, settled before completed)

OUTPUT FORMAT: Return a JSON object with:
{
  "isDuplicate": boolean,
  "confidence": number (0-1),
  "pattern": "CANNIBALISTIC|FABRICATED|STUCK|MISROUTED|FRAUD|GENUINE",
  "isolationAction": "quarantine|flag|allow|escalate",
  "reasoning": "string"
}`;

// Detection patterns for the LLM to recognize
const DETECTION_PATTERNS = {
  cannibalistic: {
    description: 'Multiple transactions with identical or near-identical fields processing the same obligation',
    indicators: [
      'Same amount ± $0.01',
      'Same source within ±1 hour',
      'Same destination',
      'Sequential entity IDs (differ by only 1-2 chars)',
      'All marked as "processing" or "in_transit"',
    ],
    severity: 'CRITICAL',
  },
  fabricated_proof: {
    description: 'Proof hash contains plaintext instead of cryptographic hash',
    indicators: [
      'sha256_ prefix followed by text',
      'Contains @ symbol (email)',
      'Contains human-readable words',
      'Length < 64 characters after prefix',
      'No hex-only pattern',
    ],
    severity: 'CRITICAL',
  },
  stuck_settlement: {
    description: 'Settlement stuck in IN_TRANSIT state for excessive time',
    indicators: [
      'Status = IN_TRANSIT for >48 hours',
      'No external reference',
      'No provider confirmation',
      'Amount is round number (possible test)',
    ],
    severity: 'HIGH',
  },
  misrouted_crypto: {
    description: 'Crypto settlement sent to non-owner address',
    indicators: [
      'Destination ≠ canonical wallet',
      'Chain not in owner config',
      'No recovery initiated',
    ],
    severity: 'CRITICAL',
  },
  state_machine_violation: {
    description: 'Transaction violates monotonically increasing state machine',
    indicators: [
      'deliveredAt < shippedAt',
      'settledAt < completedAt',
      'order-to-delivery < 1 hour',
      'quantityReceived ≠ quantityOrdered',
    ],
    severity: 'CRITICAL',
  },
};

export function buildDetectionPrompt(transactions: Record<string, unknown>[]): AuditPrompt {
  const userPrompt = `Analyze these ${transactions.length} transactions for cannibalistic duplicates, fabricated proofs, and state violations:

${JSON.stringify(transactions.slice(0, 20), null, 2)}

For each transaction, check:
1. Is this a duplicate of another transaction in the set?
2. Is the proof hash a real SHA-256 or a fabricated plaintext?
3. Is the settlement stuck for too long?
4. Is the crypto destination correct?
5. Does the state machine transition make sense?

Return an array of detection results.`;

  return {
    systemPrompt: AUDIT_SYSTEM_PROMPT,
    userPrompt,
    temperature: 0.0, // Deterministic — no randomness in audit decisions
    maxTokens: 4096,
  };
}

export async function detectDuplicates(
  transactions: Record<string, unknown>[],
): Promise<DuplicateDetection[]> {
  const results: DuplicateDetection[] = [];

  // Rule-based pre-filter (fast, no LLM needed)
  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    const detection = applyDetectionRules(tx, transactions, i);
    if (detection) {
      results.push(detection);
    }
  }

  return results;
}

function applyDetectionRules(
  tx: Record<string, unknown>,
  allTx: Record<string, unknown>[],
  index: number,
): DuplicateDetection | null {
  const amount = (tx.amount as number) || 0;
  const source = (tx.source as string) || '';
  const dest = (tx.destination as string) || (tx.recipientAddress as string) || '';
  const proofHash = (tx.proofHash as string) || (tx.event_hash as string) || '';
  const status = (tx.status as string) || '';
  const timestamp = (tx.createdAt as string) || (tx.timestamp as string) || '';

  // Check 1: Fabricated proof
  if (proofHash && proofHash.startsWith('sha256_')) {
    const suffix = proofHash.replace('sha256_', '');
    if (suffix.length < 64 || /[^0-9a-f]/.test(suffix)) {
      return {
        isDuplicate: false,
        confidence: 0.99,
        pattern: 'FABRICATED',
        isolationAction: 'quarantine',
        reasoning: `Proof hash "${proofHash.slice(0, 40)}..." is plaintext concatenation, not SHA-256. Real hashes are 64 hex chars.`,
        proofHash: '',
      };
    }
  }

  // Check 2: Cannibalistic duplicates
  const duplicates = allTx.filter((other, j) => {
    if (j <= index) return false;
    const otherAmount = (other.amount as number) || 0;
    const otherSource = (other.source as string) || '';
    const otherDest = (other.destination as string) || (other.recipientAddress as string) || '';
    return (
      Math.abs(amount - otherAmount) < 0.01 &&
      source === otherSource &&
      dest === otherDest
    );
  });

  if (duplicates.length > 0) {
    return {
      isDuplicate: true,
      confidence: 0.95,
      pattern: 'CANNIBALISTIC',
      isolationAction: 'quarantine',
      reasoning: `${duplicates.length + 1} transactions share amount=$${amount.toFixed(2)}, source='${source}', destination='${dest.slice(0, 12)}...'. Cannibalistic competition pattern.`,
      proofHash: '',
    };
  }

  // Check 3: Stuck settlement
  if (status === 'in_transit' || status === 'processing') {
    const txTime = timestamp ? new Date(timestamp).getTime() : 0;
    const hoursStuck = txTime > 0 ? (Date.now() - txTime) / 3600000 : 0;
    if (hoursStuck > 48) {
      return {
        isDuplicate: false,
        confidence: 0.90,
        pattern: 'STUCK',
        isolationAction: 'escalate',
        reasoning: `Settlement stuck in '${status}' for ${hoursStuck.toFixed(0)} hours (threshold: 48h). Probably fictional.`,
        proofHash: '',
      };
    }
  }

  return null;
}

export function getDetectionPatterns() {
  return { ...DETECTION_PATTERNS };
}
