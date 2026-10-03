// scripts/swarm-agent-query.mjs  (READ-ONLY)
//
// Queries swarm agent state: DB-level SwarmAgentContext registry + the
// local filesystem consensus/liveness state (heartbeats, votes, snapshot).
// Read-only: SELECTs only, all external input bound via parameters.
//
//   node scripts/swarm-agent-query.mjs
//
// Env: DATABASE_URL (optional — DB section is skipped when unset, the same
//      skip pattern swarm-clickless-tick.mjs uses for DB-backed audits).

import 'dotenv/config';
import { Client } from 'pg';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SWARM_DIR = resolve(ROOT, 'data', 'swarm_autonomy');

// ── Part 1: local swarm state (no DB needed) ────────────────────────────────
console.log('### Local swarm liveness (data/swarm_autonomy)');
const hbDir = resolve(SWARM_DIR, 'heartbeats');
if (existsSync(hbDir)) {
  for (const f of readdirSync(hbDir).filter(x => x.endsWith('.json'))) {
    try {
      const o = JSON.parse(readFileSync(resolve(hbDir, f), 'utf8'));
      const ageMin = Math.round((Date.now() - (o.at || 0)) / 60000);
      const verdict = ageMin < 60 ? 'ALIVE?' : ageMin < 1440 ? 'STALE' : 'DOWN';
      console.log(`  ${f.replace('.json', '').padEnd(20)} pid=${String(o.pid ?? '?').padEnd(8)} last=${o.iso ?? '?'}  age=${ageMin}min  ${verdict}`);
    } catch { console.log(`  ${f}: unreadable`); }
  }
} else {
  console.log('  (no heartbeat dir)');
}
const votesDir = resolve(SWARM_DIR, 'votes');
if (existsSync(votesDir)) {
  const votes = readdirSync(votesDir).filter(x => x.endsWith('.json'));
  console.log(`\n### Ballot files in data/swarm_autonomy/votes: ${votes.length}`);
  for (const v of votes.slice(-10)) console.log('  ', v);
}
const consensusPath = resolve(SWARM_DIR, 'state', 'consensus_state.json');
if (existsSync(consensusPath)) {
  const cs = JSON.parse(readFileSync(consensusPath, 'utf8'));
  console.log('\n### Consensus snapshot', cs.iso);
  console.log(`  holiday active: ${cs.holiday?.active}`);
  console.log(`  moneyOverridePasses: ${cs.moneyOverridePasses}`);
  console.log(`  liveness: ${cs.liveness?.processesAlive}/${cs.liveness?.processesTracked} alive (checkedAt ${cs.liveness?.checkedAt})`);
  for (const [k, t] of Object.entries(cs.tallies || {})) {
    console.log(`  tally ${k}: passes=${t.passes} voters=[${(t.voters || []).join(', ')}]${t.failsBecause?.length ? ' — ' + t.failsBecause.join('; ') : ''}`);
  }
}

// ── Part 2: DB agent registry (only when DATABASE_URL present) ──────────────
if (!process.env.DATABASE_URL) {
  console.log('\nDATABASE_URL not set — DB agent registry skipped (fail-closed pattern).');
  process.exit(0);
}

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const q = async (sql, p = []) => (await c.query(sql, p)).rows;

try {
  await c.connect();

  // Introspect SwarmAgentContext columns (identifier comes from the DB catalog
  // itself, never from user input, so the dynamic parts stay safe).
  console.log('\n### SwarmAgentContext');
  const cols = await q(`SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`, ['SwarmAgentContext']);
  if (!cols.length) {
    console.log('  (table does not exist in this database)');
  } else {
    console.log('  cols:', cols.map(r => r.column_name).join(', '));
    // Distinct agent ids, bound limit.
    const LIMIT = 40;
    const agents = await q(`SELECT DISTINCT "swarmAgentId" FROM "SwarmAgentContext" LIMIT $1`, [LIMIT]);
    console.log(`  distinct swarmAgentId (${agents.length}):`, agents.map(r => r.swarmAgentId).join(', ') || '(none)');
  }
} catch (e) {
  console.log('  DB query note:', e.message);
} finally {
  await c.end().catch(() => {});
}
