#!/usr/bin/env node
/**
 * Orchestrate live revenue ingestion for all owner payout routes.
 *
 * Providers are attempted only when their required credentials are present.
 * Missing credentials -> skipped, not failure.
 */

import { spawnSync } from 'node:child_process';

const runners = [
  {
    name: 'paypal_invoices',
    file: 'scripts/ingest-paypal-revenue-events.mjs',
    requiredEnv: ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'BASE44_SWARM_API_KEY'],
  },
  {
    name: 'paypal_transactions',
    file: 'scripts/ingest-paypal-transactions.mjs',
    requiredEnv: ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'BASE44_SWARM_API_KEY'],
  },
  {
    name: 'wise_balance_credits',
    file: 'scripts/ingest-wise-balance-credits.mjs',
    requiredEnv: ['WISE_API_KEY', 'WISE_PROFILE_ID', 'BASE44_SWARM_API_KEY'],
  },
  {
    name: 'plaid_bank_credits',
    file: 'scripts/ingest-plaid-bank-credits.mjs',
    requiredEnv: ['PLAID_CLIENT_ID', 'PLAID_SECRET', 'PLAID_ACCESS_TOKEN', 'BASE44_SWARM_API_KEY'],
  },
];

function hasEnv(names) {
  return names.every((n) => Boolean(process.env[n]));
}

function runNode(file) {
  return spawnSync(process.execPath, [file], {
    stdio: 'pipe',
    encoding: 'utf8',
    shell: false,
  });
}

const summary = [];
let hardFailure = false;

for (const runner of runners) {
  if (!hasEnv(runner.requiredEnv)) {
    console.log(`SKIP ${runner.name}: missing credentials`);
    summary.push({ name: runner.name, status: 'skipped_missing_credentials' });
    continue;
  }

  console.log(`RUN ${runner.name}`);
  const res = runNode(runner.file);
  if (res.stdout?.trim()) console.log(res.stdout.trim());
  if (res.status === 0) {
    summary.push({ name: runner.name, status: 'ok' });
  } else {
    hardFailure = true;
    if (res.stderr?.trim()) console.error(res.stderr.trim());
    summary.push({ name: runner.name, status: 'failed', code: res.status ?? 1 });
  }
}

console.log('\n=== OWNER ROUTE INGEST SUMMARY ===');
for (const row of summary) {
  console.log(`${row.name}: ${row.status}`);
}

if (hardFailure) process.exit(1);

