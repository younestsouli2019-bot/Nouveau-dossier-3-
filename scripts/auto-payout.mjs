#!/usr/bin/env node
/**
 * Auto-Payout — Monitors RevenueStreams and creates PayoutBatches when funds available.
 * Runs on schedule via revenue-monitor.yml workflow.
 *
 * Env vars:
 *   PAYOUT_THRESHOLD (default: 100) — minimum available_for_payout to trigger
 *   PAYOUT_METHOD (default: BANK_WIRE)
 *   RECIPIENT_NAME, RECIPIENT_EMAIL
 */

const AGENT = { name: 'agent-swarm', appId: '689afeabf1db9c30efe0bd7e', key: process.env.BASE44_SWARM_API_KEY || 'e599b5b131574c1bae885fc013620739' };
const THRESHOLD = parseFloat(process.env.PAYOUT_THRESHOLD || '100');
const PAYOUT_METHOD = process.env.PAYOUT_METHOD || 'BANK_WIRE';
const RECIPIENT_NAME = process.env.RECIPIENT_NAME || 'Younes Tsouli';
const RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL || 'younestsouli2019@gmail.com';

async function fetchEntities(entity) {
  const url = `https://${AGENT.name}-${AGENT.appId.slice(-8)}.base44.app/api/entities/${entity}?limit=50&sort_by=-created_date`;
  const res = await fetch(url, { headers: { api_key: AGENT.key } });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [data];
}

async function createBatch(data) {
  const url = `https://${AGENT.name}-${AGENT.appId.slice(-8)}.base44.app/api/entities/PayoutBatch`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { api_key: AGENT.key, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Base44 API error ${res.status}: ${text}`);
  }
  return res.json();
}

async function main() {
  console.log(`=== AUTO-PAYOUT MONITOR ===`);
  console.log(`Threshold: $${THRESHOLD} | Method: ${PAYOUT_METHOD}`);
  console.log(`Recipient: ${RECIPIENT_NAME} (${RECIPIENT_EMAIL})\n`);

  const streams = await fetchEntities('RevenueStream');
  console.log(`Found ${streams.length} revenue streams`);

  let totalAvailable = 0;
  const eligibleStreams = [];

  for (const stream of streams) {
    const avail = stream.available_for_payout || 0;
    totalAvailable += avail;
    if (avail >= THRESHOLD) {
      eligibleStreams.push(stream);
      console.log(`  [ELIGIBLE] ${stream.name}: $${avail.toFixed(2)} available`);
    }
  }

  console.log(`\nTotal available: $${totalAvailable.toFixed(2)}`);
  console.log(`Eligible streams (>= $${THRESHOLD}): ${eligibleStreams.length}`);

  if (eligibleStreams.length === 0) {
    console.log('\nNo streams meet payout threshold. Skipping.');
    const fs = await import('fs/promises');
    await fs.mkdir('dist_rwc', { recursive: true });
    await fs.writeFile('dist_rwc/auto-payout-result.json', JSON.stringify({
      action: 'skip',
      reason: 'no_eligible_streams',
      totalAvailable,
      threshold: THRESHOLD,
      timestamp: new Date().toISOString(),
    }, null, 2));
    return;
  }

  for (const stream of eligibleStreams) {
    const amount = stream.available_for_payout;
    const batchId = `BATCH_AUTO_${PAYOUT_METHOD}_${Date.now()}_${stream.id || stream.name.replace(/\s/g, '_')}`;

    console.log(`\nCreating payout batch: ${batchId}`);
    console.log(`  Amount: $${amount.toFixed(2)} ${stream.currency || 'USD'}`);
    console.log(`  Source: ${stream.name}`);

    try {
      const result = await createBatch({
        batch_id: batchId,
        status: 'pending',
        total_amount: amount,
        currency: stream.currency || 'USD',
        payout_method: PAYOUT_METHOD,
        notes: `Auto-payout from ${stream.name} — ${RECIPIENT_EMAIL} (${RECIPIENT_NAME})`,
      });
      console.log(`  Created: ${result.id}`);
    } catch (e) {
      console.error(`  FAILED: ${e.message}`);
    }
  }

  const fs = await import('fs/promises');
  await fs.mkdir('dist_rwc', { recursive: true });
  await fs.writeFile('dist_rwc/auto-payout-result.json', JSON.stringify({
    action: 'payout_created',
    eligibleStreams: eligibleStreams.map(s => ({ name: s.name, amount: s.available_for_payout })),
    totalPayout: eligibleStreams.reduce((s, r) => s + (r.available_for_payout || 0), 0),
    method: PAYOUT_METHOD,
    recipient: RECIPIENT_EMAIL,
    timestamp: new Date().toISOString(),
  }, null, 2));
  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
