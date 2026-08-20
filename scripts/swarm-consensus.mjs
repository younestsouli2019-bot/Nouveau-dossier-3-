// ============================================================
// SWARM CONSENSUS CLIENT (silent CLI / library)
//   - Voters cast weighted ballots for HOLIDAY / SELF_AUDIT / OVERRIDE proposals
//   - Quorum rule (majority % + min 2 voters) must PASS for any non-essential pause
//   - Essential jobs (money-moving-watchdog, heartbeats, audit-loops) run even during holidays
//   - Standalone CLI + importable module
// ============================================================
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, appendFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DATA = resolve(ROOT, 'data');
const SWARM_DIR = resolve(DATA, 'swarm_autonomy');
const VOTE_DIR = resolve(SWARM_DIR, 'votes');
const STATE_DIR = resolve(SWARM_DIR, 'state');
const LOGS_DIR = resolve(SWARM_DIR, 'logs');
[SWARM_DIR, VOTE_DIR, STATE_DIR, LOGS_DIR].forEach(d => { if (!existsSync(d)) mkdirSync(d, { recursive: true }); });

export const PROPOSAL_TYPES = {
  'HOLIDAY_NON_ESSENTIALS': { maxHours: 6, quorumPct: 0.67, requiresWeight: true, label: 'Pause non-essential swarm work up to 6h' },
  'SELF_AUDIT_NOW': { maxHours: 2, quorumPct: 0.5, requiresWeight: false, label: 'Run full self-audit immediately' },
  'ELEVATED_AUDIT_DEEP': { maxHours: 4, quorumPct: 0.6, requiresWeight: true, label: 'Run deep SQLite + CSV audit' },
  'MONEY_MOVING_BLOCKED_OVERRIDE': { maxHours: 1, quorumPct: 0.85, requiresWeight: true, label: 'Temporarily override money-moving-block (1h only)' },
};

export const VOTER_WEIGHTS = {
  'swarm-autonomy': 2,
  'swarm-improve-loop': 1,
  'final-master-audit': 3,
  'run-full-integrity-audit': 2,
  'auto_settlement_daemon': 1.5,
  'base44_push_executor': 1,
  'deep-sqlite-audit-sqljs': 2.5,
  'swarm-consensus': 1,
  'owner-directive': 5, // highest weight — owner via .env directive
};

// Essential jobs that MUST run regardless of HOLIDAY votes
export const ESSENTIAL_JOB_IDS = [
  'SELF_AUDIT_HOURLY',
  'DEEP_AUDIT_DAILY',
  'SWARM_SAFETY_SCORE_RECOMPUTE',
  'OWNER_BACK_SOON_PING',
  'RECONCILE_BALANCE_DELTA',
  'SETTLEMENT_LEDGER_UNBLOCK',
];

function sha(s) { return createHash('sha256').update(String(s)).digest('hex').slice(0, 16); }
function log(line) { appendFileSync(resolve(LOGS_DIR, 'swarm-consensus.log'), `[${new Date().toISOString()}] ${line}\n`); }

export function vote({ proposalType, voter, inFavor, extra = {}, weightOverride }) {
  if (!PROPOSAL_TYPES[proposalType]) return { ok: false, err: 'invalid proposal', supported: Object.keys(PROPOSAL_TYPES) };
  if (!voter) return { ok: false, err: 'voter required' };
  const weight = Number(weightOverride ?? (VOTER_WEIGHTS[voter] ?? 0.5));
  const ballot = { voter, weight, inFavor: Boolean(inFavor), at: Date.now(), iso: new Date().toISOString(), extra };
  const ballotId = sha(`${proposalType}:${voter}:${ballot.at}:${Math.random().toString(36).slice(2)}`);
  const file = resolve(VOTE_DIR, `${proposalType}_${ballotId}.json`);
  writeFileSync(file, JSON.stringify(ballot, null, 2));
  log(`VOTE: ${proposalType} by ${voter} → ${inFavor ? 'YES' : 'NO'} (w=${weight})`);
  return tally(proposalType);
}

export function tally(proposalType) {
  if (!PROPOSAL_TYPES[proposalType]) return { ok: false, err: 'invalid proposal' };
  const spec = PROPOSAL_TYPES[proposalType];
  const prefix = `${proposalType}_`;
  const ballots = readdirSync(VOTE_DIR).filter(f => f.startsWith(prefix) && f.endsWith('.json')).map(f => {
    try { return JSON.parse(readFileSync(resolve(VOTE_DIR, f), 'utf-8')); } catch { return null; }
  }).filter(Boolean);

  const windowMs = spec.maxHours * 3600_000;
  const now = Date.now();
  const recent = ballots.filter(b => (now - b.at) < windowMs);

  let yW = 0, nW = 0, yN = 0, nN = 0;
  for (const b of recent) {
    const w = spec.requiresWeight ? (b.weight || 0) : 1;
    if (b.inFavor) { yW += w; yN++; } else { nW += w; nN++; }
  }
  const denomVotes = yN + nN;
  const denomW = yW + nW;
  const approvalByVotes = denomVotes ? yN / denomVotes : 0;
  const approvalByWeight = denomW ? yW / denomW : 0;
  const approvalUsed = spec.requiresWeight ? approvalByWeight : approvalByVotes;

  const passes = approvalUsed >= spec.quorumPct && yN >= 2;
  return {
    ok: true,
    proposalType,
    label: spec.label,
    windowHours: spec.maxHours,
    ballotsCounted: recent.length,
    expiredBallots: ballots.length - recent.length,
    quorumPct: spec.quorumPct,
    requiresWeight: spec.requiresWeight,
    approvalPct: +approvalUsed.toFixed(3),
    approvalByVotes: +approvalByVotes.toFixed(3),
    approvalByWeight: +approvalByWeight.toFixed(3),
    yesWeighted: +yW.toFixed(2),
    noWeighted: +nW.toFixed(2),
    yesCount: yN,
    noCount: nN,
    minVotersRequired: 2,
    passes,
  };
}

export function isHolidayActive() {
  const r = tally('HOLIDAY_NON_ESSENTIALS');
  return { active: r.passes, ...r };
}

export function isJobAllowed(taskId) {
  const essential = ESSENTIAL_JOB_IDS.includes(taskId);
  if (essential) return { allowed: true, reason: 'ESSENTIAL_JOB — runs even during holiday' };
  const holiday = isHolidayActive();
  if (holiday.active) return { allowed: false, reason: `HOLIDAY_NON_ESSENTIALS active (approval=${holiday.approvalPct})`, holiday };
  return { allowed: true, reason: 'no holiday in effect' };
}

export function pruneOldVotes(maxAgeMs = 7 * 24 * 3600_000) {
  const cutoff = Date.now() - maxAgeMs;
  let n = 0;
  for (const f of readdirSync(VOTE_DIR)) {
    try { const s = statSync(resolve(VOTE_DIR, f)); if (s.mtimeMs < cutoff) { unlinkSync(resolve(VOTE_DIR, f)); n++; } } catch {}
  }
  return n;
}

export function listProposals() {
  return Object.keys(PROPOSAL_TYPES).map(k => ({ key: k, ...PROPOSAL_TYPES[k] }));
}

// Persist current active-pause flags for other swarm scripts to check (file-poll API)
export function writeConsensusState() {
  const state = {
    at: Date.now(), iso: new Date().toISOString(),
    holiday: isHolidayActive(),
    selfAuditPasses: tally('SELF_AUDIT_NOW').passes,
    deepAuditPasses: tally('ELEVATED_AUDIT_DEEP').passes,
    moneyOverridePasses: tally('MONEY_MOVING_BLOCKED_OVERRIDE').passes,
    essentials: ESSENTIAL_JOB_IDS,
  };
  writeFileSync(resolve(STATE_DIR, 'consensus_state.json'), JSON.stringify(state, null, 2));
  return state;
}

// ============================================================
// CLI: node swarm-consensus.mjs <COMMAND> [args]
// Commands:
//   list-proposals
//   vote <PROPOSAL> <VOTER> <YES|NO>
//   tally <PROPOSAL>
//   holiday-status
//   job-allowed <taskId>
//   prune
// ============================================================
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/swarm-consensus.mjs')) {
  const args = process.argv.slice(2);
  const cmd = args[0];
  (async () => {
    try {
      if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') {
        console.log(`Usage: node swarm-consensus.mjs <command> [args]
  list-proposals
  vote <PROPOSAL> <VOTER> <YES|NO>
  tally <PROPOSAL>
  holiday-status
  job-allowed <taskId>
  prune
  state
        `);
      } else if (cmd === 'list-proposals') {
        console.log(JSON.stringify(listProposals(), null, 2));
      } else if (cmd === 'vote') {
        const [, p, v, f] = args;
        console.log(JSON.stringify(vote({ proposalType: p, voter: v, inFavor: (f || '').toUpperCase() === 'YES' }), null, 2));
        writeConsensusState();
      } else if (cmd === 'tally') {
        console.log(JSON.stringify(tally(args[1]), null, 2));
      } else if (cmd === 'holiday-status') {
        console.log(JSON.stringify(isHolidayActive(), null, 2));
      } else if (cmd === 'job-allowed') {
        console.log(JSON.stringify(isJobAllowed(args[1]), null, 2));
      } else if (cmd === 'prune') {
        console.log(JSON.stringify({ pruned: pruneOldVotes() }, null, 2));
      } else if (cmd === 'state') {
        console.log(JSON.stringify(writeConsensusState(), null, 2));
      } else {
        console.error('Unknown command:', cmd);
        process.exit(2);
      }
    } catch (e) { console.error(e); process.exit(1); }
  })();
}
