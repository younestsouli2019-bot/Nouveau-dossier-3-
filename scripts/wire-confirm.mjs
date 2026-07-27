#!/usr/bin/env node
/**
 * Wire Confirmation — post-wire verification.
 * (loads .env automatically via scripts/env.mjs)
 */
import './env.mjs';
import fs from 'node:fs';

const AGENTS = [
  { name: 'agent-flow-ai', appId: '6888ac155ebf84dd9855ea98', key: process.env.BASE44_FLOW_API_KEY },
  { name: 'agent-swarm', appId: '689afeabf1db9c30efe0bd7e', key: process.env.BASE44_SWARM_API_KEY },
];

const WISE_API = process.env.WISE_ENVIRONMENT === 'live'
  ? 'https://api.wise.com'
  : 'https://api.sandbox.transferwise.tech';

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [k, ...rest] = arg.slice(2).split('=');
    out[k] = rest.join('=') || true;
  }
  return out;
}

async function fetchBatches(app, limit) {
  if (!app.key) return [];
  const url = `https://${app.name}-${app.appId.slice(-8)}.base44.app/api/entities/PayoutBatch?limit=${limit}&sort_by=-created_date`;
  const res = await fetch(url, { headers: { api_key: app.key } });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function updateBatch(app, batchId, patch) {
  const url = `https://${app.name}-${app.appId.slice(-8)}.base44.app/api/entities/PayoutBatch/${batchId}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { api_key: app.key, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Base44 update failed ${res.status}`);
  return true;
}

async function wiseGet(path) {
  const apiKey = process.env.WISE_API_KEY;
  if (!apiKey) throw new Error('Missing WISE_API_KEY');
  const res = await fetch(`${WISE_API}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Wise ${res.status}: ${t}`);
  }
  return res.json();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const limit = Number(args.limit || 50);

  console.log('=== WIRE CONFIRM (post-wire verification) ===\n');

  let verified = 0;
  let missing = 0;
  let failed = 0;
  const now = new Date().toISOString();

  for (const app of AGENTS) {
    if (!app.key) {
      console.warn(`Missing API key for ${app.name}, skipping.`);
      continue;
    }
    const batches = await fetchBatches(app, limit);
    const candidates = batches.filter((b) =>
      b.status === 'processing' &&
      String(b.batch_id || '').includes('BANK_WIRE') &&
      String(b.gateway_ref || '').startsWith('wise:'),
    );

    if (candidates.length === 0) {
      console.log(`${app.name}: nothing to verify`);
      continue;
    }
    console.log(`${app.name}: ${candidates.length} processing BANK_WIRE batch(es) with Wise refs`);

    for (const b of candidates) {
      const transferId = String(b.gateway_ref).slice('wise:'.length).trim();
      if (!transferId) continue;
      let transfer;
      try {
        transfer = await wiseGet(`/v1/transfers/${transferId}`);
      } catch (e) {
        console.warn(`  ${b.batch_id}: WISE 404/error — treating as missing: ${e.message}`);
        await updateBatch(app, b.batch_id, {
          notes: `${b.notes || ''} — Wire confirm FAILED at ${now}: ${e.message}`.trim(),
        }).catch(() => {});
        missing++;
        continue;
      }

      const status = String(transfer?.status || '').toLowerCase();
      if (['cancelled', 'rejected', 'failed', 'bounced_back'].includes(status)) {
        await updateBatch(app, b.batch_id, {
          status: 'failed',
          notes: `${b.notes || ''} — Wire confirm detected FAILED status=${status} at ${now}`.trim(),
        }).catch(() => {});
        failed++;
        console.log(`  ${b.batch_id}: FAILED (Wise status=${status})`);
      } else {
        await updateBatch(app, b.batch_id, {
          verified_at: now,
          notes: `${b.notes || ''} — Wire confirm OK status=${status} at ${now}`.trim(),
        }).catch(() => {});
        verified++;
        console.log(`  ${b.batch_id}: verified (Wise status=${status})`);
      }
    }
  }

  // Write summary
  fs.mkdirSync('dist_rwc', { recursive: true });
  fs.writeFileSync('dist_rwc/wire-confirm-result.json', JSON.stringify({
    at: now, verified, missing, failed,
  }, null, 2));

  console.log(`\n=== SUMMARY ===\nverified=${verified} missing=${missing} failed=${failed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
