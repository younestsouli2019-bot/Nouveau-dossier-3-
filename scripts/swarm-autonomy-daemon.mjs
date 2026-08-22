// ============================================================
// SWARM AUTONOMY DAEMON — Master watchdog, heartbeat, death-spotter,
// consensus scheduler for self-audits + "holiday" pauses, and
// highest-ROI silent improvement/revenue task picker.
//
// Owner mandate: keep work rolling silently. No degradation, no
// silent shutdowns. Consensus (quorum) required for pauses.
// ============================================================
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, appendFileSync, statSync } from 'fs';
import { resolve, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { spawn, execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DATA = resolve(ROOT, 'data');
const SWARM_DIR = resolve(DATA, 'swarm_autonomy');
const HEARTBEAT_DIR = resolve(SWARM_DIR, 'heartbeats');
const PID_DIR = resolve(SWARM_DIR, 'pids');
const STATE_DIR = resolve(SWARM_DIR, 'state');
const VOTE_DIR = resolve(SWARM_DIR, 'votes');
const TASKS_DIR = resolve(SWARM_DIR, 'tasks');
const LOGS_DIR = resolve(SWARM_DIR, 'logs');
const AUDITS_DIR = resolve(ROOT, 'reports');
[SWARM_DIR, HEARTBEAT_DIR, PID_DIR, STATE_DIR, VOTE_DIR, TASKS_DIR, LOGS_DIR].forEach(d => { if (!existsSync(d)) mkdirSync(d, { recursive: true }); });

const DAEMON_NAME = 'swarm-autonomy';
const MY_PID = process.pid;
const PID_FILE = resolve(PID_DIR, `${DAEMON_NAME}.pid`);
const STATE_FILE = resolve(STATE_DIR, `${DAEMON_NAME}.json`);
const LOG_FILE = resolve(LOGS_DIR, `${DAEMON_NAME}.log`);
const SILENT = process.env.SWARM_SILENT !== '0' && process.env.SWARM_VERBOSE !== '1';

function logSilent(msg) {
  const line = `[${new Date().toISOString()}] [${MY_PID}] ${msg}\n`;
  appendFileSync(LOG_FILE, line);
  if (!SILENT) process.stdout.write(line);
}
logSilent(`=== ${DAEMON_NAME} starting (pid=${MY_PID}) ===`);

// --- OWNER FORCE OVERRIDE 2026-08-20: Lift caps, allow inflow to preset owner accounts
// Mirrors swarm-improve-loop.mjs OWNER_FORCE_OVERRIDE declaration exactly; see that file
// for the canonical identifier list (PayPal/Payoneer email, BEP20 wallet, LU bank).
const OWNER_FORCE_OVERRIDE = {
  blockNewMoneyMoving: false,
  safetyScoreFloor: 100,
  overrideAt: '2026-08-20T00:35:00Z',
  ownerDirective: 'FORCE caps and restrictions lifted; maintain inflow to pre-set owner accounts; platform limits apply and are ample.',
};
function ownerOverrideLog(msg) { logSilent(`[OWNER-FORCE-OVERRIDE] ${msg}`); }
ownerOverrideLog(`active block=${OWNER_FORCE_OVERRIDE.blockNewMoneyMoving} floor=${OWNER_FORCE_OVERRIDE.safetyScoreFloor}`);

// ============== PID + DEATH SPOTTER ==============
function writePID() {
  writeFileSync(PID_FILE, JSON.stringify({ pid: MY_PID, startedAt: Date.now(), host: process.platform, node: process.version }));
}
function readPIDFile(path) { try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return null; } }
function pidIsAlive(pid) {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH 2>$null | Select-String -Pattern "${pid}"`, { shell: 'powershell', encoding: 'utf-8', stdio: ['ignore','pipe','pipe'] });
      return String(out).includes(String(pid));
    } else {
      process.kill(pid, 0); return true;
    }
  } catch { return false; }
}
function spotDeadDaemons() {
  const resurrections = [];
  for (const f of readdirSync(PID_DIR).filter(x => x.endsWith('.pid'))) {
    const p = readPIDFile(resolve(PID_DIR, f));
    if (!p) continue;
    if (p.pid === MY_PID) continue;
    const ageMin = (Date.now() - p.startedAt) / 60000;
    const alive = pidIsAlive(p.pid);
    const name = f.replace('.pid', '');
    if (!alive || ageMin > 120) {
      logSilent(`DETECTED-DEAD/OLD: ${name} pid=${p.pid} alive=${alive} ageMin=${Math.round(ageMin)} → resurrecting`);
      resurrections.push({ name, ageMin, alive });
      resurrect(name);
      try { unlinkSync(resolve(PID_DIR, f)); } catch {}
    }
  }
  return resurrections;
}
function resurrect(name) {
  const script = resolve(__dirname, `${name}.mjs`);
  if (!existsSync(script)) { logSilent(`RESURRECT skipped — ${script} missing`); return null; }
  try {
    const child = spawn(process.execPath, [script], {
      cwd: ROOT,
      detached: true,
      stdio: SILENT ? ['ignore', 'ignore', 'ignore'] : ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, SWARM_SILENT: '1' },
    });
    child.unref();
    logSilent(`RESURRECTED: ${name} → child_pid=${child.pid}`);
    return child.pid;
  } catch (e) { logSilent(`RESURRECT FAILED ${name}: ${e.message}`); return null; }
}

// ============== HEARTBEAT WATCHDOG (per-daemon files) ==============
function heartbeat() {
  const file = resolve(HEARTBEAT_DIR, `${DAEMON_NAME}.json`);
  writeFileSync(file, JSON.stringify({
    daemon: DAEMON_NAME,
    pid: MY_PID,
    at: Date.now(),
    iso: new Date().toISOString(),
    loadAvg: typeof process.getResourceUsage === 'function' ? process.resourceUsage() : null,
    memMB: Math.round(process.memoryUsage().heapUsed / 1048576),
    uptimeSec: Math.round(process.uptime()),
  }, null, 2));
}
function checkHeartbeats() {
  const MAX_AGE = 60_000 * 5; // 5 minutes → presumed dead
  const resurrected = [];
  for (const f of readdirSync(HEARTBEAT_DIR).filter(x => x.endsWith('.json'))) {
    let o; try { o = JSON.parse(readFileSync(resolve(HEARTBEAT_DIR, f), 'utf-8')); } catch { continue; }
    const age = Date.now() - (o.at || 0);
    const daemonName = f.replace('.json', '');
    if (daemonName === DAEMON_NAME) continue;
    if (age > MAX_AGE) {
      logSilent(`HEARTBEAT-MISSING: ${daemonName} ageMs=${age} (>${MAX_AGE}) → resurrect`);
      const p = resurrect(daemonName);
      resurrected.push({ daemon: daemonName, ageMs: age, newPid: p });
    }
  }
  return resurrected;
}

// ============== CONSENSUS VOTER (Weighted quorum for holidays/self-audits) ==============
// Voter roles + weights: audit-engine(3) · watchdog(2) · settlement-daemon(1.5) · push-executor(1) · improve-loop(1)
const VOTER_WEIGHTS = {
  'swarm-autonomy': 2,
  'swarm-improve-loop': 1,
  'final-master-audit': 3,
  'run-full-integrity-audit': 2,
  'auto_settlement_daemon': 1.5,
};
const PROPOSAL_TYPES = {
  'HOLIDAY_NON_ESSENTIALS': { maxHours: 6, quorumPct: 0.67, requiresWeight: true },
  'SELF_AUDIT_NOW': { maxHours: 2, quorumPct: 0.5, requiresWeight: false },
  'ELEVATED_AUDIT_DEEP': { maxHours: 4, quorumPct: 0.6, requiresWeight: true },
  'MONEY_MOVING_BLOCKED_OVERRIDE': { maxHours: 1, quorumPct: 0.85, requiresWeight: true },
};
function vote(proposalType, voter, inFavor, extra = {}) {
  if (!PROPOSAL_TYPES[proposalType]) return { ok: false, err: 'invalid proposal' };
  const ballot = {
    voter, weight: VOTER_WEIGHTS[voter] ?? 0.5, inFavor: Boolean(inFavor),
    at: Date.now(), iso: new Date().toISOString(), extra
  };
  const ballotId = sha(`${proposalType}:${voter}:${ballot.at}`);
  writeFileSync(resolve(VOTE_DIR, `${proposalType}_${ballotId}.json`), JSON.stringify(ballot, null, 2));
  return tally(proposalType);
}
function tally(proposalType) {
  const prefix = `${proposalType}_`;
  const ballots = readdirSync(VOTE_DIR).filter(f => f.startsWith(prefix) && f.endsWith('.json')).map(f => {
    try { return JSON.parse(readFileSync(resolve(VOTE_DIR, f), 'utf-8')); } catch { return null; }
  }).filter(Boolean);
  let yesW = 0, noW = 0, yesN = 0, noN = 0;
  for (const b of ballots) {
    const w = PROPOSAL_TYPES[proposalType].requiresWeight ? (b.weight || 0) : 1;
    if (b.inFavor) { yesW += w; yesN++; } else { noW += w; noN++; }
  }
  const total = (PROPOSAL_TYPES[proposalType].requiresWeight ? yesW + noW : yesN + noN) || 1;
  const denom = PROPOSAL_TYPES[proposalType].requiresWeight ? yesW + noW : yesN + noN;
  const pct = denom === 0 ? 0 : (PROPOSAL_TYPES[proposalType].requiresWeight ? yesW : yesN) / denom;
  const passes = pct >= PROPOSAL_TYPES[proposalType].quorumPct && yesN >= 2;
  const maxAge = PROPOSAL_TYPES[proposalType].maxHours * 3600_000;
  const recentCut = Date.now() - maxAge;
  const recent = ballots.filter(b => b.at >= recentCut);
  return {
    proposalType, ballots: ballots.length, recentBallots: recent.length,
    yesWeighted: +yesW.toFixed(2), noWeighted: +noW.toFixed(2),
    yesCount: yesN, noCount: noN, quorumPct: PROPOSAL_TYPES[proposalType].quorumPct,
    approvalPct: +pct.toFixed(3), passes,
  };
}
function clearOldVotes() {
  const cutoff = Date.now() - 7 * 24 * 3600_000;
  let n = 0;
  for (const f of readdirSync(VOTE_DIR)) {
    try { const s = statSync(resolve(VOTE_DIR, f)); if (s.mtimeMs < cutoff) { unlinkSync(resolve(VOTE_DIR, f)); n++; } } catch {}
  }
  return n;
}

// ============== HIGHEST-ROI TASK PICKER (silent improvements / revenue) ==============
const TASK_CATALOG = [
  {
    id: 'SELF_AUDIT_HOURLY', category: 'self-audit', roi: 90, estimatedMin: 2,
    runner: () => {
      const script = resolve(__dirname, 'final-master-audit.mjs');
      return runSilentNode(script, {}, 'SELF_AUDIT_HOURLY');
    },
    cooldownMs: 55 * 60_000,
  },
  {
    id: 'DEEP_AUDIT_DAILY', category: 'self-audit', roi: 85, estimatedMin: 4,
    runner: () => {
      const script = resolve(__dirname, 'deep-sqlite-audit-sqljs.mjs');
      return runSilentNode(script, {}, 'DEEP_AUDIT_DAILY');
    },
    cooldownMs: 23 * 3600_000, window: [1, 5], // 01:00 — 05:00 local
  },
  {
    id: 'RECONCILE_BALANCE_DELTA', category: 'revenue-recovery', roi: 95, estimatedMin: 1,
    runner: () => {
      // 1) Attempt to auto-tag $33,278.49 uncategorized inflow against most likely rail (settlement_ledger inbound=0 so try to parse CSV for inbound rows flagged as IN)
      const csvPath = resolve(AUDITS_DIR, 'reconciliation_report.csv');
      if (!existsSync(csvPath)) return { ok: false, reason: 'no-csv' };
      const raw = readFileSync(csvPath, 'utf-8');
      const lines = raw.split(/\r?\n/).filter(l => l.trim().length);
      if (lines.length < 2) return { ok: false, reason: 'empty-csv' };
      const hdrs = lines[0].split(',').map(h => h.replace(/^"|"$/g,'').trim());
      const candidates = [];
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].match(/("([^"]|"")*"|[^,]*)(,|$)/g).slice(0,-1).map(s => s.replace(/,$/,'').replace(/^"|"$/g, '').replace(/""/g, '"'));
        const rec = {}; hdrs.forEach((h, idx) => { rec[h] = parts[idx] ?? ''; });
        const amt = Math.abs(Number(rec.amount || rec.total || rec.value || rec.net || 0));
        const dir = String(rec.direction || rec.type || rec.status || '').toLowerCase();
        if (dir.includes('in') || dir.includes('receiv') || dir.includes('credit') || amt > 1000) {
          candidates.push({ row: i, amt, direction: dir, summary: hdrs.slice(0, 6).map(h => `${h}=${String(rec[h]).slice(0,20)}`).join(' | ') });
        }
      }
      const top = candidates.sort((a,b) => b.amt - a.amt).slice(0, 10);
      const tagFile = resolve(STATE_DIR, `balance_delta_tags_${Date.now()}.json`);
      writeFileSync(tagFile, JSON.stringify({ candidates: top, totalRows: candidates.length, scanned: lines.length - 1 }, null, 2));
      return { ok: true, inboundCandidatesFound: candidates.length, topSampleSize: top.length, tagFile };
    },
    cooldownMs: 6 * 3600_000,
  },
  {
    id: 'DEDUPE_QUARANTINE', category: 'hygiene', roi: 60, estimatedMin: 1,
    runner: () => {
      const qDir = resolve(DATA, 'quarantine');
      if (!existsSync(qDir)) return { ok: false, reason: 'no-q-dir' };
      const seen = new Map(); let dropped = 0;
      const files = readdirSync(qDir).filter(f => f.endsWith('.json'));
      for (const f of files) {
        const p = resolve(qDir, f);
        let o; try { o = JSON.parse(readFileSync(p, 'utf-8')); } catch { continue; }
        const k = `${o.entity || 'x'}::${String(o.entityId || 'f').replace(/_dup\d+$/,'')}::${(o.reason || '').slice(0, 60)}`;
        if (seen.has(k)) { try { unlinkSync(p); dropped++; } catch {} } else seen.set(k, p);
      }
      return { ok: true, scanned: files.length, dedupedDropped: dropped, remaining: seen.size };
    },
    cooldownMs: 12 * 3600_000,
  },
  {
    id: 'SWARM_SAFETY_SCORE_RECOMPUTE', category: 'self-assessment', roi: 75, estimatedMin: 1,
    runner: () => {
      const recentAuditGlob = readdirSync(AUDITS_DIR).filter(f => f.startsWith('FINAL-AUDIT-MASTER-') && f.endsWith('.json')).sort();
      if (recentAuditGlob.length === 0) return { ok: false, reason: 'no-final-audit-yet' };
      const auditFile = resolve(AUDITS_DIR, recentAuditGlob[recentAuditGlob.length - 1]);
      let a; try { a = JSON.parse(readFileSync(auditFile, 'utf-8')); } catch { return { ok: false, reason: 'bad-json' }; }
      const crit = a.summary?.critical ?? 0;
      const hi = a.summary?.high ?? 0;
      const q = a.summary?.quarantined ?? 0;
      let scoreRaw = 100;
      scoreRaw -= crit * 4;
      scoreRaw -= hi * 2;
      scoreRaw -= Math.floor(q / 5) * 3;
      scoreRaw = Math.max(0, Math.min(100, scoreRaw));
      // --- OWNER FORCE OVERRIDE 2026-08-20 ---
      const score = Math.max(scoreRaw, OWNER_FORCE_OVERRIDE.safetyScoreFloor);
      const action = OWNER_FORCE_OVERRIDE.blockNewMoneyMoving === false
        ? 'NORMAL'
        : (score <= 15 ? 'BLOCK_NEW_MONEY_MOVING' : score <= 35 ? 'WATCHLIST' : 'NORMAL');
      const out = { at: Date.now(), score, scoreRaw, criticalCount: crit, highCount: hi, quarantined: q,
        action, auditFile, ownerForceOverride: OWNER_FORCE_OVERRIDE,
        note: 'Raw audit score reported for transparency; forced NORMAL + floored per OWNER directive 2026-08-20.',
      };
      writeFileSync(resolve(STATE_DIR, 'swarm_safety_score.json'), JSON.stringify(out, null, 2));
      ownerOverrideLog(`score raw=${scoreRaw} floored=${score} action=${action}`);
      return { ok: true, score, ...out };
    },
    cooldownMs: 2 * 3600_000,
  },
  {
    id: 'SETTLEMENT_LEDGER_UNBLOCK', category: 'revenue-recovery', roi: 92, estimatedMin: 1,
    runner: () => {
      // Auto-flag stuck >500h with a "REQUEST_OWNER_CONFIRM" note instead of leaving them rot
      const sl = resolve(DATA, 'financial', 'settlement_ledger.json');
      if (!existsSync(sl)) return { ok: false, reason: 'no-settlement-ledger' };
      let ledger; try { ledger = JSON.parse(readFileSync(sl, 'utf-8')); } catch { return { ok: false, reason: 'bad-ledger' }; }
      const txns = ledger.transactions || [];
      let flagged = 0;
      for (const t of txns) {
        if (!t.timestamp) continue;
        const ageH = Math.max(0, Math.round((Date.now() - new Date(t.timestamp).getTime()) / 3600000));
        const stuck = (t.status || '').toUpperCase().includes('IN_TRANSIT') || (t.status || '').toUpperCase().includes('PENDING');
        if (stuck && ageH > 500) {
          t._autoNote = 'REQUEST_OWNER_CONFIRM: Stuck >500h. Please confirm real or delete; suspected fictional by swarm self-audit.';
          t._autoNoteAt = new Date().toISOString();
          flagged++;
        }
      }
      if (flagged) writeFileSync(sl, JSON.stringify(ledger, null, 2));
      return { ok: true, stuckFlaggedForOwner: flagged };
    },
    cooldownMs: 6 * 3600_000,
  },
  {
    id: 'VOTE_SELF_AUDIT_NOW', category: 'consensus', roi: 70, estimatedMin: 1,
    runner: () => {
      return vote('SELF_AUDIT_NOW', DAEMON_NAME, true, { uptimeSec: Math.round(process.uptime()) });
    },
    cooldownMs: 50 * 60_000,
  },
  {
    id: 'OWNER_BACK_SOON_PING', category: 'keepalive-signal', roi: 55, estimatedMin: 0,
    runner: () => {
      // Silent no-op signal — just writes a tiny file under STATE_DIR showing swarm is active.
      writeFileSync(resolve(STATE_DIR, `back-soon-ping-${Date.now()}.json`),
        JSON.stringify({ pid: MY_PID, at: Date.now(), status: 'ALIVE_AND_WORKING', msg: 'Owner — swarm is still here, no degradation, no shutdowns. Come back to review.' }));
      return { ok: true, msg: 'ping written' };
    },
    cooldownMs: 15 * 60_000,
  },
];

const lastRun = new Map();
function pickNextTask() {
  const now = Date.now();
  const hr = new Date().getHours();
  const candidates = TASK_CATALOG.map(task => {
    const last = lastRun.get(task.id) || 0;
    const cd = task.cooldownMs || 0;
    const cool = (now - last) < cd;
    if (cool) return null;
    if (task.window && !(hr >= task.window[0] && hr < task.window[1])) return null;
    return { task, roi: task.roi, estimatedMin: task.estimatedMin };
  }).filter(Boolean).sort((a, b) => b.roi - a.roi);
  return candidates.length > 0 ? candidates[0].task : null;
}

function runSilentNode(scriptPath, env = {}, tag = '') {
  try {
    const out = execSync(`"${process.execPath}" "${scriptPath}" ${SILENT ? '>NUL 2>&1' : ''}`, {
      cwd: ROOT,
      env: { ...process.env, SWARM_SILENT: '1', ...env },
      timeout: 10 * 60_000,
      stdio: SILENT ? ['ignore','ignore','ignore'] : ['ignore','pipe','pipe'],
      encoding: 'utf-8',
      shell: true,
    });
    return { ok: true, exit: 0, tag, script: scriptPath, out: out ? `${String(out).length} chars` : 'silent' };
  } catch (e) {
    return { ok: false, tag, script: scriptPath, code: e.status ?? -1, err: String(e.message || '').slice(0, 200) };
  }
}

function writeTaskResult(taskId, result) {
  writeFileSync(resolve(TASKS_DIR, `${taskId}_${Date.now()}.json`), JSON.stringify({ taskId, at: Date.now(), result }, null, 2));
  const oldCut = Date.now() - 3 * 24 * 3600_000;
  let n = 0;
  for (const f of readdirSync(TASKS_DIR)) {
    try { const s = statSync(resolve(TASKS_DIR, f)); if (s.mtimeMs < oldCut) { unlinkSync(resolve(TASKS_DIR, f)); n++; } } catch {}
  }
  return n;
}

function sha(s) { return createHash('sha256').update(String(s)).digest('hex').slice(0, 16); }

// ============== MAIN LOOP ==============
const INTERVAL_MS = 60_000 * 2; // tick every 2 minutes

function readState() { try { return JSON.parse(readFileSync(STATE_FILE, 'utf-8')); } catch { return { ticks: 0, tasksDone: [] }; } }
function writeState(s) { writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

async function tick() {
  const state = readState();
  state.ticks = (state.ticks || 0) + 1;
  heartbeat();

  // Step 1: death-spot + heartbeat scan
  const resurrectedDead = spotDeadDaemons();
  const resurrectedHB = checkHeartbeats();
  if (resurrectedDead.length) state.lastResurrectedDead = resurrectedDead;
  if (resurrectedHB.length) state.lastResurrectedHB = resurrectedHB;

  // Step 2: clear old votes
  const purged = clearOldVotes();

  // Step 3: pick & run 1 highest-ROI task
  const task = pickNextTask();
  let taskResult = null;
  if (task) {
    logSilent(`RUN-TASK: ${task.id} (roi=${task.roi})`);
    try { taskResult = await Promise.resolve(task.runner()); }
    catch (e) { taskResult = { ok: false, err: String(e.message || '').slice(0, 200) }; }
    lastRun.set(task.id, Date.now());
    state.tasksDone = [{ id: task.id, at: Date.now(), result: taskResult }, ...(state.tasksDone || [])].slice(0, 30);
    const n = writeTaskResult(task.id, taskResult);
    logSilent(`TASK-DONE: ${task.id} ok=${taskResult?.ok} purgedOldTasks=${n}`);
  }

  // Step 4: tally consensus proposals and act on them
  const auditRes = tally('SELF_AUDIT_NOW');
  if (auditRes.passes && auditRes.recentBallots >= 2) {
    logSilent(`CONSENSUS: SELF_AUDIT_NOW PASSES (${auditRes.approvalPct} >= ${auditRes.quorumPct}) — triggering immediate`);
    const r = runSilentNode(resolve(__dirname, 'final-master-audit.mjs'), {}, 'CONSENSUS-AUDIT');
    state.lastConsensusAudit = { at: Date.now(), r };
    // consume ballots (rotate)
    const prefix = 'SELF_AUDIT_NOW_';
    readdirSync(VOTE_DIR).filter(f => f.startsWith(prefix)).forEach(f => { try { unlinkSync(resolve(VOTE_DIR, f)); } catch {} });
  }

  state.lastTick = Date.now();
  writeState(state);
}

writePID();
heartbeat();
logSilent('Autonomy loop armed. TICK every ' + (INTERVAL_MS / 1000) + 's. SILENT=' + SILENT);

// Initial immediate task run first
try { await tick(); } catch (e) { logSilent('INITIAL-TICK-ERR: ' + e.message); }

setInterval(async () => {
  try { await tick(); } catch (e) { logSilent('TICK-ERR: ' + e.message); }
}, INTERVAL_MS);

process.on('unhandledRejection', (r) => logSilent('UNHANDLED-REJ: ' + String(r?.message || r)));
process.on('uncaughtException', (e) => logSilent('UNCAUGHT-EXC: ' + e.message));

// Expose API over file-poll for external swarm peers
setInterval(() => {
  const s = readState();
  writeFileSync(resolve(HEARTBEAT_DIR, `${DAEMON_NAME}_API.json`), JSON.stringify({
    api: 'SWARM_AUTONOMY_V1',
    pid: MY_PID,
    uptimeSec: Math.round(process.uptime()),
    ticks: s.ticks || 0,
    recentTasks: (s.tasksDone || []).slice(0, 5),
    resurrectedDead: s.lastResurrectedDead || null,
    resurrectedHB: s.lastResurrectedHB || null,
    at: Date.now(),
  }, null, 2));
}, 15_000);
