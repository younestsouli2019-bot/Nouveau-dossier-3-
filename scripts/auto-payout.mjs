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
const LIVE_ONLY_PAYOUTS = process.env.LIVE_ONLY_PAYOUTS !== 'false';
const ALLOW_BALANCE_ONLY_PAYOUT = process.env.ALLOW_BALANCE_ONLY_PAYOUT === 'true';
const LIVE_REVENUE_LOOKBACK_DAYS = parseInt(process.env.LIVE_REVENUE_LOOKBACK_DAYS || '45', 10);

async function fetchEntities(entity) {
  const url = `https://${AGENT.name}-${AGENT.appId.slice(-8)}.base44.app/api/entities/${entity}?limit=50&sort_by=-created_date`;
  const res = await fetch(url, { headers: { api_key: AGENT.key } });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [data];
}

function daysAgo(days) {
  return Date.now() - (days * 24 * 60 * 60 * 1000);
}

function isRecent(dateLike) {
  if (!dateLike) return false;
  const ts = new Date(dateLike).getTime();
  return Number.isFinite(ts) && ts >= daysAgo(LIVE_REVENUE_LOOKBACK_DAYS);
}

function isLiveRevenueEvent(event) {
  const status = String(event.status || '').toLowerCase();
  // Live evidence must be an externally confirmed cash event, not a forecast.
  const allowed = new Set(['paid', 'completed', 'settled', 'received']);
  return !event.is_sample &&
    allowed.has(status) &&
    (event.amount || 0) > 0 &&
    isRecent(event.occurred_at || event.created_date);
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

async function updateEntity(entity, id, patch) {
  const url = `https://${AGENT.name}-${AGENT.appId.slice(-8)}.base44.app/api/entities/${entity}/${id}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { api_key: AGENT.key, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Base44 update ${entity}/${id} ${res.status}: ${text}`);
  }
  return res.json();
}

async function main() {
  console.log(`=== AUTO-PAYOUT MONITOR ===`);
  console.log(`Threshold: $${THRESHOLD} | Method: ${PAYOUT_METHOD}`);
  console.log(`Recipient: ${RECIPIENT_NAME} (${RECIPIENT_EMAIL})\n`);

  const [streams, events] = await Promise.all([
    fetchEntities('RevenueStream'),
    fetchEntities('RevenueEvent'),
  ]);
  console.log(`Found ${streams.length} revenue streams`);
  console.log(`Found ${events.length} revenue events`);

  const liveEvents = events.filter(isLiveRevenueEvent);
  console.log(`Live revenue evidence (last ${LIVE_REVENUE_LOOKBACK_DAYS}d): ${liveEvents.length}`);

  // Live-only payout = payout from unbatched live revenue events, not from seeded stream balances.
  const unbatchedLiveEvents = liveEvents.filter((e) => {
    const ps = String(e.payout_status || '').toLowerCase();
    return ps !== 'batched' && ps !== 'settled' && ps !== 'paid_out';
  });
  const liveEventTotal = unbatchedLiveEvents.reduce((s, e) => s + (e.amount || 0), 0);
  if (LIVE_ONLY_PAYOUTS && !ALLOW_BALANCE_ONLY_PAYOUT) {
    console.log(`Unbatched live events: ${unbatchedLiveEvents.length} | Total: $${liveEventTotal.toFixed(2)}`);
  }

  let totalAvailable = 0;
  const eligibleStreams = [];
  const rejectedStreams = [];

  for (const stream of streams) {
    const avail = stream.available_for_payout || 0;
    totalAvailable += avail;
    const isActive = String(stream.status || '').toLowerCase() === 'active';
    const isSample = Boolean(stream.is_sample);

    if (!isActive || isSample) {
      rejectedStreams.push({
        name: stream.name,
        amount: avail,
        reason: !isActive ? 'not_active' : 'sample_stream',
      });
      continue;
    }

    if (avail >= THRESHOLD) {
      eligibleStreams.push(stream);
      console.log(`  [ELIGIBLE] ${stream.name}: $${avail.toFixed(2)} available`);
    }
  }

  console.log(`\nTotal available: $${totalAvailable.toFixed(2)}`);
  console.log(`Eligible streams (>= $${THRESHOLD}): ${eligibleStreams.length}`);

  if (LIVE_ONLY_PAYOUTS && !ALLOW_BALANCE_ONLY_PAYOUT && unbatchedLiveEvents.length === 0) {
    console.log('\nNo recent live revenue events found. LIVE_ONLY_PAYOUTS blocks balance-only automatic payouts.');
    const fs = await import('fs/promises');
    await fs.mkdir('dist_rwc', { recursive: true });
    await fs.writeFile('dist_rwc/auto-payout-result.json', JSON.stringify({
      action: 'skip',
      reason: 'no_live_revenue_evidence',
      totalAvailable,
      threshold: THRESHOLD,
      liveEvents: liveEvents.length,
      unbatchedLiveEvents: unbatchedLiveEvents.length,
      lookbackDays: LIVE_REVENUE_LOOKBACK_DAYS,
      eligibleStreams: eligibleStreams.map(s => ({ name: s.name, amount: s.available_for_payout })),
      rejectedStreams,
      timestamp: new Date().toISOString(),
    }, null, 2));
    return;
  }

  if (eligibleStreams.length === 0) {
    console.log('\nNo streams meet payout threshold. Skipping.');
    const fs = await import('fs/promises');
    await fs.mkdir('dist_rwc', { recursive: true });
    await fs.writeFile('dist_rwc/auto-payout-result.json', JSON.stringify({
      action: 'skip',
      reason: 'no_eligible_streams',
      totalAvailable,
      threshold: THRESHOLD,
      liveEvents: liveEvents.length,
      lookbackDays: LIVE_REVENUE_LOOKBACK_DAYS,
      rejectedStreams,
      timestamp: new Date().toISOString(),
    }, null, 2));
    return;
  }

  // Create payout batches.
  // - Live-only: one batch per currency based on unbatched live events only.
  // - Balance-only (explicit override): legacy behavior per stream.
  if (LIVE_ONLY_PAYOUTS && !ALLOW_BALANCE_ONLY_PAYOUT) {
    const byCurrency = new Map();
    for (const e of unbatchedLiveEvents) {
      const ccy = String(e.currency || 'USD').toUpperCase();
      if (!byCurrency.has(ccy)) byCurrency.set(ccy, []);
      byCurrency.get(ccy).push(e);
    }

    for (const [ccy, evs] of byCurrency.entries()) {
      const amount = evs.reduce((s, e) => s + (e.amount || 0), 0);
      if (amount < THRESHOLD) continue;
      const batchId = `BATCH_LIVE_${PAYOUT_METHOD}_${Date.now()}_${ccy}`;
      const previewIds = evs.slice(0, 15).map((e) => e.external_id || e.id).filter(Boolean).join(', ');
      const more = evs.length > 15 ? ` (+${evs.length - 15} more)` : '';

      console.log(`\nCreating LIVE payout batch: ${batchId}`);
      console.log(`  Amount: $${amount.toFixed(2)} ${ccy}`);
      console.log(`  Events: ${previewIds}${more}`);

      const result = await createBatch({
        batch_id: batchId,
        status: 'pending',
        total_amount: amount,
        currency: ccy,
        payout_method: PAYOUT_METHOD,
        notes: `LIVE_ONLY payout — ${RECIPIENT_EMAIL} (${RECIPIENT_NAME}) — LIVE_EVIDENCE=${evs.length} — LOOKBACK_DAYS=${LIVE_REVENUE_LOOKBACK_DAYS}`,
      });
      console.log(`  Created: ${result.id}`);

      // Mark events as batched to prevent double payout.
      for (const e of evs) {
        try {
          await updateEntity('RevenueEvent', e.id, {
            payout_status: 'batched',
            payout_batch_id: batchId,
            batched_at: new Date().toISOString(),
          });
        } catch (err) {
          console.error(`  WARN: Failed to tag RevenueEvent ${e.id} as batched: ${err.message}`);
        }
      }
    }
  } else {
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
          notes: `Auto-payout from ${stream.name} — ${RECIPIENT_EMAIL} (${RECIPIENT_NAME}) — LIVE_EVIDENCE=${liveEvents.length} — LOOKBACK_DAYS=${LIVE_REVENUE_LOOKBACK_DAYS}`,
        });
        console.log(`  Created: ${result.id}`);
      } catch (e) {
        console.error(`  FAILED: ${e.message}`);
      }
    }
  }

  const fs = await import('fs/promises');
  await fs.mkdir('dist_rwc', { recursive: true });
  await fs.writeFile('dist_rwc/auto-payout-result.json', JSON.stringify({
    action: 'payout_created',
    eligibleStreams: eligibleStreams.map(s => ({ name: s.name, amount: s.available_for_payout })),
    rejectedStreams,
    totalPayout: eligibleStreams.reduce((s, r) => s + (r.available_for_payout || 0), 0),
    method: PAYOUT_METHOD,
    recipient: RECIPIENT_EMAIL,
    liveEvents: liveEvents.length,
    unbatchedLiveEvents: unbatchedLiveEvents.length,
    liveEventTotal,
    lookbackDays: LIVE_REVENUE_LOOKBACK_DAYS,
    timestamp: new Date().toISOString(),
  }, null, 2));
  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
