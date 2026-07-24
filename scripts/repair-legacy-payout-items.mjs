#!/usr/bin/env node
/**
 * Repair legacy AgentSwarm PayoutItems that are marked success without external evidence,
 * have routing mismatches, and reference orphaned batch IDs (AUTO-YYYY-MM-DD).
 *
 * This script is intentionally conservative:
 * - does NOT attempt to send money
 * - normalizes records for audit correctness and dashboard clarity
 *
 * What it does:
 * 1) Create placeholder PayoutBatch records for AUTO-... batch IDs if missing (status=failed)
 *    so PayoutItems are no longer "orphaned".
 * 2) Fix routing mismatch: if recipient_type=paypal_email but bank_name is present,
 *    set recipient_type=bank_account.
 * 3) Fix false success: if status=success and external_transaction_id is missing,
 *    set status=failed and set error_message.
 *
 * Usage:
 *   node scripts/repair-legacy-payout-items.mjs
 *
 * Env:
 *   BASE44_SWARM_API_KEY (required)
 */

const AGENT = { name: 'agent-swarm', appId: '689afeabf1db9c30efe0bd7e', key: process.env.BASE44_SWARM_API_KEY || '' };

function must(v, name) {
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry(fn, label, maxRetries = 6) {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = String(e?.message || e);
      const isRateLimit = msg.includes(' 429') || msg.includes('Rate limit exceeded');
      if (!isRateLimit || i === maxRetries) throw e;
      const delay = Math.min(30000, 1000 * 2 ** i);
      console.warn(`Rate limited on ${label}. Retry ${i + 1}/${maxRetries} in ${delay}ms`);
      await sleep(delay);
    }
  }
  return null;
}

async function list(entity, limit = 200) {
  const url = `https://${AGENT.name}-${AGENT.appId.slice(-8)}.base44.app/api/entities/${entity}?limit=${limit}&sort_by=-created_date`;
  const res = await fetch(url, { headers: { api_key: AGENT.key } });
  if (!res.ok) throw new Error(`${entity} list failed ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [data];
}

async function create(entity, payload) {
  const url = `https://${AGENT.name}-${AGENT.appId.slice(-8)}.base44.app/api/entities/${entity}`;
  return withRetry(async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { api_key: AGENT.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`${entity} create failed ${res.status}: ${t}`);
    }
    return res.json();
  }, `${entity}.create`);
}

async function update(entity, id, patch) {
  const url = `https://${AGENT.name}-${AGENT.appId.slice(-8)}.base44.app/api/entities/${entity}/${id}`;
  return withRetry(async () => {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { api_key: AGENT.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`${entity} update failed ${res.status}: ${t}`);
    }
    return res.json();
  }, `${entity}.update.${id}`);
}

function isAutoBatchId(batchId) {
  return /^AUTO-\d{4}-\d{2}-\d{2}$/.test(String(batchId || ''));
}

async function main() {
  must(AGENT.key, 'BASE44_SWARM_API_KEY');

  const [items, batches] = await Promise.all([
    list('PayoutItem', 250),
    list('PayoutBatch', 400),
  ]);

  const batchSet = new Set(batches.map((b) => b.batch_id));
  const autoBatchIds = [...new Set(items.map((i) => i.batch_id).filter(isAutoBatchId))];

  let placeholderCreated = 0;
  for (const batchId of autoBatchIds) {
    if (batchSet.has(batchId)) continue;
    // Create a "do not execute" placeholder record. This is to remove orphaned references.
    await create('PayoutBatch', {
      batch_id: batchId,
      status: 'failed',
      total_amount: 0,
      currency: 'USD',
      revenue_event_ids: [],
      notes: 'LEGACY PLACEHOLDER: created to un-orphan legacy PayoutItems. Multi-currency batch_id; do not execute.',
      processed_at: new Date().toISOString(),
    });
    placeholderCreated++;
  }

  let routingFixed = 0;
  let falseSuccessFixed = 0;

  for (const it of items) {
    const patch = {};
    const bankName = String(it.bank_name || '').trim();

    // Fix routing mismatch on legacy records
    if (it.recipient_type === 'paypal_email' && bankName) {
      patch.recipient_type = 'bank_account';
      routingFixed++;
    }

    // Fix false success
    if (it.status === 'success' && !it.external_transaction_id) {
      patch.status = 'failed';
      patch.error_message = 'No external transaction ID (legacy record). Marked failed for audit correctness.';
      falseSuccessFixed++;
    }

    if (Object.keys(patch).length === 0) continue;
    await update('PayoutItem', it.id, patch);
    // Be gentle with Base44 API rate limits.
    await sleep(250);
  }

  const out = {
    scannedItems: items.length,
    scannedBatches: batches.length,
    autoBatchIds,
    placeholderBatchesCreated: placeholderCreated,
    routingFixed,
    falseSuccessFixed,
    timestamp: new Date().toISOString(),
  };

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
