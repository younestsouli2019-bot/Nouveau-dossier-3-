#!/usr/bin/env node
/**
 * Unfreeze Autonomous Agent
 * Resets the .autonomous-state.json to clear ERROR_STORM_PROTECTION freeze.
 */

import fs from 'fs/promises';
import path from 'path';

const STATE_FILE = '.autonomous-state.json';

async function main() {
  let state;
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf8');
    state = JSON.parse(raw);
  } catch {
    state = {};
  }

  const wasFrozen = state.freeze?.active;
  const failures = state.consecutiveFailures || 0;

  state.consecutiveFailures = 0;
  state.freeze = { active: false, reason: null };
  state.updatedAt = new Date().toISOString();

  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));

  console.log('=== AGENT STATUS ===');
  console.log(`  Was frozen: ${wasFrozen}`);
  console.log(`  Previous failures: ${failures}`);
  console.log(`  Now: unfrozen, failure count reset to 0`);
  console.log('\nAutonomous agent is ready to run.');
}

main().catch(e => { console.error(e); process.exit(1); });
