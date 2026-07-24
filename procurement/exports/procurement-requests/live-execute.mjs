#!/usr/bin/env node
/**
 * Live procurement execution orchestrator.
 *
 * Steps:
 * 1. Validate tracker consistency
 * 2. Sync all procurement requests to Base44
 * 3. Build outreach queue for all batches
 * 4. Optionally send all queued outreach messages when enabled
 * 5. Emit delivery report
 */

import { spawnSync } from 'node:child_process';

const SEND_ENABLED = process.env.PROCUREMENT_SEND_ENABLED === 'true';
const DRY_RUN = process.env.PROCUREMENT_DRY_RUN === 'true';

function runStep(label, file, args = []) {
  console.log(`\n=== ${label} ===`);
  const res = spawnSync(process.execPath, [file, ...args], {
    stdio: 'inherit',
    shell: false,
    env: process.env,
  });
  if (res.status !== 0) {
    throw new Error(`${label} failed with exit code ${res.status ?? 1}`);
  }
}

runStep('Validate procurement trackers', 'procurement/exports/procurement-requests/validate-trackers.mjs');
runStep('Sync procurement requests to Base44', 'procurement/exports/procurement-requests/base44-sync.mjs', ['--action=sync-all']);
runStep('Build outreach queue', 'procurement/exports/procurement-requests/send-outreach.mjs', ['--send-all', '--build-only']);

if (SEND_ENABLED) {
  const args = ['--send-all'];
  if (DRY_RUN) args.push('--dry-run');
  runStep(DRY_RUN ? 'Dry-run outreach queue' : 'Send outreach queue', 'procurement/exports/procurement-requests/send-outreach.mjs', args);
} else {
  console.log('\nSkipping outreach send: PROCUREMENT_SEND_ENABLED is not true');
}

runStep('Generate delivery report', 'procurement/exports/procurement-requests/delivery-tracker.mjs', ['--action=report']);

console.log('\nProcurement live execution complete.');

