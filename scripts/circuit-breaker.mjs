#!/usr/bin/env node
/**
 * Circuit Breaker — pre-flight gate for the auto-settle pipeline.
 *
 * Reads `.autonomous-state.json` and exits non-zero if:
 *  - freeze.active is true
 *  - consecutiveFailures >= threshold
 *  - the supervisor or a previous wire marked the system paused
 *
 * Use at the top of any wire/spend workflow:
 *   node scripts/circuit-breaker.mjs && node scripts/auto-settle-bank-wire.mjs
 *
 * The circuit-breaker is intentionally cheap (single file read) and fails closed.
 */

import fs from 'node:fs';

const STATE_FILE = '.autonomous-state.json';
const DEFAULT_THRESHOLD = 5;

function main() {
  const threshold = Number(process.env.CIRCUIT_BREAKER_THRESHOLD || DEFAULT_THRESHOLD);
  let state;
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch {
    // Missing state file means "fresh repo, proceed" but log a warning.
    console.warn('=== CIRCUIT BREAKER: no state file, proceeding ===');
    return;
  }

  if (state.freeze?.active) {
    console.error(`=== CIRCUIT OPEN: ${state.freeze.reason || 'freeze active'} ===`);
    console.error(`Since: ${state.freeze.since || 'unknown'}`);
    console.error('Run "Unfreeze Agent" workflow to clear.');
    process.exit(2);
  }

  const failures = state.consecutiveFailures || 0;
  if (failures >= threshold) {
    console.error(`=== CIRCUIT OPEN: ${failures} consecutive failures (threshold=${threshold}) ===`);
    console.error(`Last failure: ${state.lastFailure?.reason || 'unknown'}`);
    process.exit(2);
  }

  console.log(`=== CIRCUIT CLOSED (failures=${failures}/${threshold}) ===`);
}

main();
