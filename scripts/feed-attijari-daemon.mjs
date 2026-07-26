#!/usr/bin/env node
/**
 * AUTONOMOUS DAEMON: Continuously run the full feed-attijari pipeline.
 *
 * Loop (every N seconds, default 60):
 *   1. Check for any of:
 *      - WISE_API_KEY + WISE_PROFILE_ID           → run auto-settle-bank-wire.mjs
 *      - BANKING_CIRCLE_CLIENT_ID + SECRET         → run banking-circle-direct-wire.mjs
 *      - logged-in Attijari cookies               → run attijari-autofill.mjs (Puppeteer)
 *      - otherwise                                → run auto-attijari-wire.mjs (offline-ledger mode)
 *   2. Run auto-payout.mjs (creates PayoutBatches from live revenue)
 *   3. Run reconcile-settlements.mjs (catches any drift)
 *   4. Run notify-owner.mjs (alerts on completion)
 *   5. Sleep N seconds, repeat
 *
 * Run:
 *   node scripts/feed-attijari-daemon.mjs                     # 60s loop, forever
 *   node scripts/feed-attijari-daemon.mjs --interval=30        # 30s loop
 *   node scripts/feed-attijari-daemon.mjs --once               # one iteration then exit
 *   node scripts/feed-attijari-daemon.mjs --max-runs=10       # bounded loop
 *
 * PID file: /tmp/feed-attijari-daemon.pid
 * Log: dist_rwc/daemon-<ts>.log
 */

import { writeFile, appendFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

function parseArgs(argv) {
  const out = { interval: 60, once: false, maxRuns: Infinity };
  for (const a of argv) {
    if (!a.startsWith('--')) continue;
    const [k, ...rest] = a.slice(2).split('=');
    const v = rest.join('=') || true;
    out[k] = Number(v) || v;
  }
  return out;
}

const ts = new Date().toISOString().replace(/[:.]/g, '-');
const PID_FILE = '/tmp/feed-attijari-daemon.pid';
const LOG_DIR = 'dist_rwc';

function runCmd(label, script, extraEnv = {}) {
  return new Promise((resolve) => {
    console.log(`  ${label}…`);
    const env = { ...process.env, ...extraEnv };
    const child = spawn('node', [script], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d.toString(); process.stdout.write(d); });
    child.stderr.on('data', (d) => { err += d.toString(); process.stderr.write(d); });
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

async function oneIteration(runIdx) {
  const stamp = new Date().toISOString();
  console.log(`\n=== ITERATION ${runIdx} @ ${stamp} ===`);

  const hasWise = !!process.env.WISE_API_KEY && !!process.env.WISE_PROFILE_ID;
  const hasBC = !!process.env.BANKING_CIRCLE_CLIENT_ID && !!process.env.BANKING_CIRCLE_CLIENT_SECRET;
  const cookiesExist = existsSync('exports/settlement/attijari-cookies.json');
  const hasAllCreds = hasWise || hasBC;

  console.log(`  Wise:    ${hasWise ? 'yes' : 'no'}`);
  console.log(`  BC:      ${hasBC ? 'yes' : 'no'}`);
  console.log(`  Cookie:  ${cookiesExist ? 'yes' : 'no'}`);

  // 1. generate portal instructions
  await runCmd('generate-portal-instructions', 'scripts/generate-portal-instructions.mjs');

  // 2. seed offline ledger (idempotent)
  await runCmd('seed-offline-ledger', 'scripts/seed-offline-ledger-recovery.mjs');

  // 3. auto-attijari-wire (offline ledger) — always runs, writes wire packets
  if (process.env.ALLOW_OFFLINE_LEDGER === 'true' || !hasAllCreds) {
    await runCmd('auto-attijari-wire', 'scripts/auto-attijari-wire.mjs', { ALLOW_OFFLINE_LEDGER: 'true' });
  }

  // 4. banking circle direct (if creds)
  if (hasBC) {
    await runCmd('bc-direct-wire', 'scripts/banking-circle-direct-wire.mjs');
  }

  // 5. wise path (if creds)
  if (hasWise) {
    await runCmd('auto-settle-bank-wire', 'scripts/auto-settle-bank-wire.mjs');
    await runCmd('poll-wise-bank-wire', 'scripts/poll-wise-bank-wire.mjs');
  }

  // 6. auto-payout
  await runCmd('auto-payout', 'scripts/auto-payout.mjs');

  // 7. reconcile
  await runCmd('reconcile-settlements', 'scripts/reconcile-settlements.mjs');

  console.log(`=== ITERATION ${runIdx} DONE ===\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const interval = args.interval;
  const once = args.once;
  const maxRuns = args.maxRuns;

  await mkdir(LOG_DIR, { recursive: true });
  await writeFile(PID_FILE, String(process.pid));

  console.log('=== FEED-ATTIJARI AUTONOMOUS DAEMON ===');
  console.log(`PID:        ${process.pid}`);
  console.log(`Interval:   ${interval}s`);
  console.log(`Max runs:   ${maxRuns === Infinity ? 'unbounded' : maxRuns}`);
  console.log(`Once:       ${once}`);
  console.log(`Log dir:    ${LOG_DIR}/`);
  console.log('');

  let run = 0;
  while (run < maxRuns) {
    run++;
    try {
      await oneIteration(run);
    } catch (e) {
      console.error(`Iteration ${run} error:`, e.message);
    }
    if (once || run >= maxRuns) break;
    await new Promise((r) => setTimeout(r, interval * 1000));
  }

  console.log(`Daemon exiting after ${run} run(s).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
