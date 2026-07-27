#!/usr/bin/env node
/**
 * Supervisor Loop — non-stop orchestrator for the bank-wire pipeline.
 * (loads .env automatically via scripts/env.mjs)
 */
import './env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const STATE_FILE = '.autonomous-state.json';
const HEARTBEAT_FILE = 'dist_rwc/supervisor-heartbeat.json';

const APPS = [
  { name: 'agent-flow-ai', appId: '6888ac155ebf84dd9855ea98', key: process.env.BASE44_FLOW_API_KEY },
  { name: 'agent-swarm', appId: '689afeabf1db9c30efe0bd7e', key: process.env.BASE44_SWARM_API_KEY },
];

const MAX_FAILURES = Number(process.env.SUPERVISOR_MAX_FAILURES || 5);
const STALE_HOURS = Number(process.env.SUPERVISOR_STALE_HOURS || 12);

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function withRetry(fn, label, maxRetries = 2) {
  for (let i = 0; i <= maxRetries; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === maxRetries) throw e;
      await sleep(500 * 2 ** i);
    }
  }
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { consecutiveFailures: 0, freeze: { active: false } }; }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function bumpFailure(state, reason) {
  state.consecutiveFailures = (state.consecutiveFailures || 0) + 1;
  state.lastFailure = { at: new Date().toISOString(), reason };
  if (state.consecutiveFailures >= MAX_FAILURES) {
    state.freeze = {
      active: true,
      reason: `circuit-open: ${state.consecutiveFailures} consecutive failures — last: ${reason}`,
      since: new Date().toISOString(),
    };
  }
  return state;
}

function resetFailure(state) {
  if (state.consecutiveFailures) {
    state.consecutiveFailures = 0;
    delete state.lastFailure;
  }
  return state;
}

async function fetchBatches(app) {
  if (!app.key) return [];
  const url = `https://${app.name}-${app.appId.slice(-8)}.base44.app/api/entities/PayoutBatch?limit=200&sort_by=-created_date`;
  const res = await withRetry(() => fetch(url, { headers: { api_key: app.key } }), `fetch ${app.name}`);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

function classify(batches) {
  const out = { pending: [], processing: [], recentCompleted: [], inTransit: [] };
  const cutoff = Date.now() - STALE_HOURS * 3600 * 1000;
  for (const b of batches) {
    const isWire = String(b.batch_id || '').includes('BANK_WIRE');
    if (!isWire) continue;
    if (b.status === 'pending') out.pending.push(b);
    else if (b.status === 'processing') {
      out.processing.push(b);
      if (String(b.gateway_ref || '').startsWith('wise:')) out.inTransit.push(b);
    } else if (b.status === 'completed') {
      const ts = b.confirmed_at || b.processed_at;
      if (ts && new Date(ts).getTime() >= cutoff) out.recentCompleted.push(b);
    }
  }
  return out;
}

function triggerWorkflow(name) {
  try {
    execSync(`gh workflow run "${name}"`, { stdio: 'pipe' });
    return true;
  } catch (e) {
    console.warn(`  Failed to trigger ${name}: ${e.message?.split('\n')[0] || e.message}`);
    return false;
  }
}

async function main() {
  console.log('=== SUPERVISOR LOOP ===\n');
  const state = loadState();

  // Circuit breaker
  if (state.freeze?.active) {
    console.log(`Circuit OPEN: ${state.freeze.reason}`);
    console.log('Run "Unfreeze Agent" workflow to clear.');
    process.exit(0);
  }

  // Inspect both apps
  let allPending = 0;
  let allInTransit = 0;
  let allRecent = 0;
  for (const app of APPS) {
    if (!app.key) {
      console.warn(`Missing API key for ${app.name}, skipping.`);
      continue;
    }
    const batches = await fetchBatches(app);
    const cls = classify(batches);
    allPending += cls.pending.length;
    allInTransit += cls.inTransit.length;
    allRecent += cls.recentCompleted.length;
    console.log(`${app.name}: pending=${cls.pending.length} processing=${cls.processing.length} inTransit=${cls.inTransit.length} recentCompleted=${cls.recentCompleted.length}`);
  }

  const actions = [];
  if (allPending > 0) {
    console.log(`\nTrigger: bank-wire-settle (${allPending} pending)`);
    if (triggerWorkflow('bank-wire-settle.yml')) actions.push('settle');
  }
  if (allInTransit > 0) {
    console.log(`Trigger: bank-wire-poll (${allInTransit} in transit)`);
    if (triggerWorkflow('bank-wire-poll.yml')) actions.push('poll');
    console.log('Trigger: wire-confirm (in transit verification)');
    if (triggerWorkflow('wire-confirm.yml')) actions.push('wire-confirm');
  }
  if (allPending === 0 && allInTransit === 0 && allRecent === 0) {
    console.log('\nNo recent activity. Trigger: revenue-monitor');
    if (triggerWorkflow('revenue-monitor.yml')) actions.push('revenue-monitor');
  }
  // Always keep the financial status fresh for the owner
  if (triggerWorkflow('financial-status.yml')) actions.push('financial-status');
  // Always run deadman-watch (cheap, idempotent)
  if (triggerWorkflow('bank-wire-deadman.yml')) actions.push('deadman');

  // Heartbeat
  fs.mkdirSync(path.dirname(HEARTBEAT_FILE), { recursive: true });
  const heartbeat = {
    at: new Date().toISOString(),
    pending: allPending,
    inTransit: allInTransit,
    recentCompleted: allRecent,
    actions,
    consecutiveFailures: state.consecutiveFailures || 0,
  };
  fs.writeFileSync(HEARTBEAT_FILE, JSON.stringify(heartbeat, null, 2));

  // Update state
  state.lastHeartbeatAt = heartbeat.at;
  state.lastLoopAt = heartbeat.at;
  if (actions.length > 0) resetFailure(state);
  saveState(state);

  console.log(`\n=== SUPERVISOR OK (${actions.length} action(s)) ===`);
  console.log(JSON.stringify(heartbeat, null, 2));
}

main().catch((e) => {
  console.error('Supervisor failed:', e.message);
  try {
    const state = loadState();
    bumpFailure(state, e.message);
    saveState(state);
  } catch { /* ignore */ }
  process.exit(1);
});
