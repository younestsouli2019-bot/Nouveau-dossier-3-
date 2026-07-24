#!/usr/bin/env node
/**
 * Poll Wise transfer status for BANK_WIRE batches and auto-confirm when Wise reports completion.
 *
 * This is the "hands-free" closer:
 * - `auto-settle-bank-wire.mjs` submits a transfer and sets `status=processing` + `gateway_ref=wise:<transferId>`
 * - this script polls Wise for transfer final status and promotes the batch to `completed`
 *
 * Limits:
 * - Wise "completed/outgoing_payment_sent" is the best available automated signal.
 * - It does not cryptographically prove the recipient bank credited the funds, but it is the closest
 *   fully automated confirmation available without bank statement APIs.
 *
 * Usage:
 *   node scripts/poll-wise-bank-wire.mjs
 */

const AGENTS = [
  { name: 'agent-flow-ai', appId: '6888ac155ebf84dd9855ea98', key: process.env.BASE44_FLOW_API_KEY || '5b4be0fada884ca28142a3279e9880f6' },
  { name: 'agent-swarm', appId: '689afeabf1db9c30efe0bd7e', key: process.env.BASE44_SWARM_API_KEY || 'e599b5b131574c1bae885fc013620739' },
];

const WISE_API = process.env.WISE_ENVIRONMENT === 'live'
  ? 'https://api.wise.com'
  : 'https://api.sandbox.transferwise.tech';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function withRetry(fn, label, maxRetries = 3) {
  for (let i = 0; i <= maxRetries; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === maxRetries) throw e;
      const delay = 1000 * 2 ** i;
      console.warn(`Retry ${i + 1}/${maxRetries} for ${label} in ${delay}ms: ${e.message}`);
      await sleep(delay);
    }
  }
}

async function wiseReq(endpoint) {
  const apiKey = process.env.WISE_API_KEY;
  if (!apiKey) throw new Error('Missing WISE_API_KEY');
  const res = await withRetry(() => fetch(`${WISE_API}${endpoint}`, {
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  }), `wise ${endpoint}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Wise ${res.status}: ${t}`);
  }
  return res.json();
}

async function fetchRecentBatches(agent) {
  const url = `https://${agent.name}-${agent.appId.slice(-8)}.base44.app/api/entities/PayoutBatch?limit=100&sort_by=-created_date`;
  const res = await withRetry(() => fetch(url, { headers: { api_key: agent.key } }), `fetch ${agent.name}`);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function updateBatch(agent, batchId, patch) {
  const url = `https://${agent.name}-${agent.appId.slice(-8)}.base44.app/api/entities/PayoutBatch/${batchId}`;
  const res = await withRetry(() => fetch(url, {
    method: 'PUT',
    headers: { api_key: agent.key, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }), `update ${batchId}`);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Base44 update failed ${res.status}: ${t}`);
  }
  return true;
}

function classifyWiseStatus(status) {
  const s = String(status || '').toLowerCase();
  // Treat these as "submitted/in transit"
  const inTransit = new Set(['incoming_payment_waiting', 'processing', 'funds_converted', 'outgoing_payment_waiting', 'bounced_back']);
  // Treat these as "done"
  const done = new Set(['outgoing_payment_sent', 'completed']);
  // Treat these as "failed"
  const failed = new Set(['cancelled', 'rejected', 'failed']);

  if (done.has(s)) return 'done';
  if (failed.has(s)) return 'failed';
  if (inTransit.has(s)) return 'in_transit';
  return 'unknown';
}

async function main() {
  console.log('=== POLL WISE BANK WIRES ===\n');
  let promoted = 0;
  let stillTransit = 0;
  let failed = 0;

  for (const agent of AGENTS) {
    const batches = await fetchRecentBatches(agent);
    const candidates = batches.filter((b) =>
      b.status === 'processing' &&
      String(b.batch_id || '').includes('BANK_WIRE') &&
      String(b.gateway_ref || '').startsWith('wise:'),
    );

    if (candidates.length === 0) continue;
    console.log(`${agent.name}: ${candidates.length} processing BANK_WIRE batch(es) with Wise refs`);

    for (const b of candidates) {
      const transferId = String(b.gateway_ref).slice('wise:'.length).trim();
      if (!transferId) continue;

      let transfer;
      try {
        transfer = await wiseReq(`/v1/transfers/${transferId}`);
      } catch (e) {
        console.warn(`  ${b.batch_id}: unable to read Wise transfer ${transferId}: ${e.message}`);
        continue;
      }

      const status = transfer?.status || '';
      const cls = classifyWiseStatus(status);

      if (cls === 'done') {
        const confirmedAt = new Date().toISOString();
        await updateBatch(agent, b.batch_id, {
          status: 'completed',
          confirmed_at: confirmedAt,
          receipt_ref: `wise:${transferId}:${status}`,
          received_by: 'WiseAuto',
          notes: `${b.notes || ''} — Auto-confirmed by Wise status=${status} at ${confirmedAt}`.trim(),
        });
        promoted++;
        console.log(`  ${b.batch_id}: completed (Wise status=${status})`);
      } else if (cls === 'failed') {
        await updateBatch(agent, b.batch_id, {
          status: 'failed',
          notes: `${b.notes || ''} — Wise transfer ${transferId} failed status=${status}`.trim(),
        });
        failed++;
        console.log(`  ${b.batch_id}: failed (Wise status=${status})`);
      } else {
        stillTransit++;
        console.log(`  ${b.batch_id}: still processing (Wise status=${status || 'unknown'})`);
      }
    }

    console.log('');
  }

  console.log('=== SUMMARY ===');
  console.log(`Auto-confirmed: ${promoted}`);
  console.log(`Still in-transit: ${stillTransit}`);
  console.log(`Marked failed: ${failed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

