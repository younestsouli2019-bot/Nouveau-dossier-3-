#!/usr/bin/env node
/**
 * QUICK-SET: Push the recovery batches through the full pipeline in one shot.
 * Useful for one-off runs; the daemon handles the looping case.
 * (loads .env automatically via scripts/env.mjs)
 */
import './env.mjs';
import { spawnSync } from 'node:child_process';

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    if (!a.startsWith('--')) continue;
    const [k, ...rest] = a.slice(2).split('=');
    out[k] = rest.join('=') || true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.bc) {
  const [id, secret, account] = args.bc.split(',');
  if (id) process.env.BANKING_CIRCLE_CLIENT_ID = id;
  if (secret) process.env.BANKING_CIRCLE_CLIENT_SECRET = secret;
  if (account) process.env.BC_DEBTOR_ACCOUNT = account;
  console.log('  set BC creds inline');
}

if (args.wise) {
  const [k, p] = args.wise.split(',');
  if (k) process.env.WISE_API_KEY = k;
  if (p) process.env.WISE_PROFILE_ID = p;
  console.log('  set Wise creds inline');
}

const env = { ...process.env, ALLOW_OFFLINE_LEDGER: 'true' };
const steps = [
  ['seed-offline-ledger',       'scripts/seed-offline-ledger-recovery.mjs'],
  ['generate-portal-instr',     'scripts/generate-portal-instructions.mjs'],
  ['auto-attijari-wire',        'scripts/auto-attijari-wire.mjs'],
  ['auto-payout',               'scripts/auto-payout.mjs'],
  ['reconcile-settlements',     'scripts/reconcile-settlements.mjs'],
];

if (env.BANKING_CIRCLE_CLIENT_ID && env.BANKING_CIRCLE_CLIENT_SECRET) {
  steps.push(['bc-direct-wire', 'scripts/banking-circle-direct-wire.mjs']);
}
if (env.WISE_API_KEY && env.WISE_PROFILE_ID) {
  steps.push(['auto-settle-bank-wire', 'scripts/auto-settle-bank-wire.mjs']);
  steps.push(['poll-wise-bank-wire',   'scripts/poll-wise-bank-wire.mjs']);
}

console.log('\n=== QUICK-SET FULL PIPELINE ===\n');
for (const [label, script] of steps) {
  console.log(`─── ${label} ───`);
  const r = spawnSync('node', [script], { env, stdio: 'inherit' });
  if (r.status !== 0) {
    console.log(`  (exit ${r.status} — continuing)`);
  }
}
console.log('\n=== DONE ===\n');
