#!/usr/bin/env node
/**
 * Bank Wire Deadman Switch.
 * (loads .env automatically via scripts/env.mjs)
 */
import './env.mjs';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const STATE_FILE = '.autonomous-state.json';
const ALERT_COOLDOWN_MS = 6 * 3600 * 1000; // 6h between alerts
const DEFAULT_HOURS = 24;

const APPS = [
  { name: 'agent-flow-ai', appId: '6888ac155ebf84dd9855ea98', key: process.env.BASE44_FLOW_API_KEY },
  { name: 'agent-swarm', appId: '689afeabf1db9c30efe0bd7e', key: process.env.BASE44_SWARM_API_KEY },
];

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [k, ...rest] = arg.slice(2).split('=');
    out[k] = rest.join('=') || true;
  }
  return out;
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return {}; }
}

function saveState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

async function fetchBatches(app) {
  if (!app.key) return [];
  const url = `https://${app.name}-${app.appId.slice(-8)}.base44.app/api/entities/PayoutBatch?limit=300&sort_by=-created_date`;
  const res = await fetch(url, { headers: { api_key: app.key } });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function notify(payload) {
  const hook = process.env.OWNER_NOTIFICATION_WEBHOOK;
  if (!hook) {
    console.log('No OWNER_NOTIFICATION_WEBHOOK set. Skipping notify.');
    return;
  }
  try {
    await fetch(hook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    console.log('Notification sent.');
  } catch (e) {
    console.warn(`Notify failed: ${e.message}`);
  }
}

function triggerWorkflow(name) {
  try {
    execSync(`gh workflow run "${name}"`, { stdio: 'pipe' });
    return true;
  } catch (e) {
    console.warn(`Failed to trigger ${name}: ${e.message?.split('\n')[0] || e.message}`);
    return false;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const hours = Number(args.hours || DEFAULT_HOURS);
  const autoRecover = args.recover !== 'false';
  const state = loadState();

  console.log(`=== BANK WIRE DEADMAN (lookback=${hours}h) ===\n`);

  const now = Date.now();
  const cutoff = now - hours * 3600 * 1000;
  let lastCompletedAt = null;
  let pendingCount = 0;
  let processingCount = 0;

  for (const app of APPS) {
    if (!app.key) {
      console.warn(`Missing API key for ${app.name}, skipping.`);
      continue;
    }
    const batches = await fetchBatches(app);
    const wires = batches.filter((b) => String(b.batch_id || '').includes('BANK_WIRE'));
    for (const b of wires) {
      if (b.status === 'pending') pendingCount++;
      else if (b.status === 'processing') processingCount++;
      else if (b.status === 'completed') {
        const ts = b.confirmed_at || b.processed_at;
        if (ts) {
          const t = new Date(ts).getTime();
          if (!Number.isNaN(t) && (!lastCompletedAt || t > lastCompletedAt)) lastCompletedAt = t;
        }
      }
    }
    console.log(`${app.name}: ${wires.length} BANK_WIRE total, pending=${pendingCount}, processing=${processingCount}`);
  }

  const alertNeeded = !lastCompletedAt || lastCompletedAt < cutoff;
  const lastAlertAt = state.lastDeadmanAt || 0;
  const cooldownPassed = (now - lastAlertAt) >= ALERT_COOLDOWN_MS;

  console.log(`\nLast completed: ${lastCompletedAt ? new Date(lastCompletedAt).toISOString() : 'NEVER'}`);
  console.log(`Alert needed: ${alertNeeded} (last alert: ${lastAlertAt ? new Date(lastAlertAt).toISOString() : 'never'})`);

  if (alertNeeded && cooldownPassed) {
    state.lastDeadmanAt = now;
    state.lastDeadmanReason = `No successful BANK_WIRE in ${hours}h (pending=${pendingCount}, processing=${processingCount})`;
    saveState(state);

    const payload = {
      content: `🚨 Bank Wire Deadman Switch`,
      embeds: [{
        title: 'No successful bank wire in ' + hours + 'h',
        color: 0xff0000,
        fields: [
          { name: 'Last completed', value: lastCompletedAt ? new Date(lastCompletedAt).toISOString() : 'NEVER', inline: false },
          { name: 'Pending', value: String(pendingCount), inline: true },
          { name: 'Processing', value: String(processingCount), inline: true },
        ],
        timestamp: new Date().toISOString(),
      }],
    };
    await notify(payload);

    if (autoRecover) {
      console.log('Auto-recover: triggering bank-wire-settle workflow');
      triggerWorkflow('bank-wire-settle.yml');
    }

    process.exit(1);
  }

  console.log('OK: deadman switch healthy.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
