#!/usr/bin/env node
/**
 * SEED OFFLINE LEDGER with the 4 RECOVERY_BANK_WIRE batches as completed
 * earnings for the Owner beneficiary. Bridges the Base44 PayoutBatch state
 * to the legacy .base44-offline-store.json format expected by
 * scripts/auto-attijari-wire.mjs so the offline-ledger path picks them up.
 *
 * Idempotent: dedupes by earning id.
 */

import { readFile, writeFile } from 'node:fs/promises';

const STORE = '.base44-offline-store.json';
const BENEFICIARY = 'Owner';
const SOURCE = 'paypal_bridge_recovery';

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    if (!a.startsWith('--')) continue;
    const [k, ...rest] = a.slice(2).split('=');
    out[k] = rest.join('=') || true;
  }
  return out;
}

async function fetchRecoveryBatches() {
  const url = 'https://agent-flow-ai-9855ea98.base44.app/api/entities/PayoutBatch?limit=200&sort_by=-created_date';
  const res = await fetch(url, { headers: { api_key: '5b4be0fada884ca28142a3279e9880f6' } });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

function earningFromBatch(batch, idx) {
  const ts = new Date().toISOString();
  return {
    id: `offline_Earning_${batch.batch_id}`,
    created_date: ts,
    updated_date: ts,
    earning_id: `REV_RECOVERY_${batch.batch_id.split('_').pop()}_${Date.now() + idx}`,
    amount: Number(batch.total_amount || 0),
    currency: 'USD',
    occurred_at: new Date('2026-07-24T08:00:00Z').toISOString(),
    source: SOURCE,
    beneficiary: BENEFICIARY,
    status: 'completed',
    settlement_id: null,
    metadata: {
      payer_name: 'M TSOULI YOUNES',
      payer_email: 'younestsouli2019@gmail.com',
      payer_company: 'Owner (Bridge Recovery)',
      purpose: `PayPal Bridge Recovery Batch ${idx + 1} — funds available 2026-07-24`,
      reference: `BATCH_RECOVERY_BANK_WIRE_${batch.batch_id.split('_').pop()}`,
      base44_batch_id: batch.batch_id,
      base44_row_id: batch.id,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = !!args['dry-run'];
  console.log('=== SEED OFFLINE LEDGER WITH RECOVERY BATCHES ===');
  console.log(`Mode: ${dryRun ? 'DRY-RUN' : 'LIVE'}\n`);

  let store = { entities: { Earning: { records: [] } } };
  try {
    store = JSON.parse(await readFile(STORE, 'utf8'));
  } catch (e) { /* create new */ }
  if (!store.entities?.Earning?.records) {
    store.entities = { ...(store.entities || {}), Earning: { records: [] } };
  }
  const existingIds = new Set(store.entities.Earning.records.map((r) => r.id));

  const batches = (await fetchRecoveryBatches()).filter((b) =>
    String(b.batch_id || '').includes('RECOVERY_BANK_WIRE'),
  );
  if (batches.length === 0) {
    console.log('No RECOVERY_BANK_WIRE batches in Base44.');
    process.exit(1);
  }

  let added = 0, skipped = 0;
  for (let i = 0; i < batches.length; i++) {
    const b = batches[i];
    const earning = earningFromBatch(b, i);
    if (existingIds.has(earning.id)) {
      skipped++;
      console.log(`  EXISTS  ${earning.id}  ($${earning.amount})`);
      continue;
    }
    if (dryRun) {
      console.log(`  WOULD-ADD  ${earning.id}  ($${earning.amount})`);
    } else {
      store.entities.Earning.records.push(earning);
      console.log(`  ADDED  ${earning.id}  ($${earning.amount})`);
    }
    added++;
  }

  if (!dryRun && added > 0) {
    await writeFile(STORE, JSON.stringify(store, null, 2) + '\n', 'utf8');
    console.log(`\n  Wrote ${STORE} (${store.entities.Earning.records.length} total earnings)`);
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Added: ${added}`);
  console.log(`Skipped: ${skipped}`);
  if (added > 0 && !dryRun) {
    console.log(`\nNext: ALLOW_OFFLINE_LEDGER=true node scripts/auto-attijari-wire.mjs`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
