#!/usr/bin/env node
/**
 * GENERATE PORTAL INSTRUCTIONS
 *
 * Reads the 4 RECOVERY_BANK_WIRE PayoutBatch rows in agent-flow-ai Base44
 * and emits wire instructions in the format expected by scripts/attijari-autofill.mjs
 * and scripts/auto-execute-wire.mjs at:
 *
 *   exports/settlement/instructions/wire_<BATCH_ID>.json
 *
 * With status=ready_for_portal so the Puppeteer auto-fill scripts pick them up.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const INSTRUCTIONS_DIR = 'exports/settlement/instructions';
const AGENTS = [
  { name: 'agent-flow-ai', appId: '6888ac155ebf84dd9855ea98', key: process.env.BASE44_FLOW_API_KEY || '5b4be0fada884ca28142a3279e9880f6' },
  { name: 'agent-swarm',  appId: '689afeabf1db9c30efe0bd7e',   key: process.env.BASE44_SWARM_API_KEY || 'e599b5b131574c1bae885fc013620739' },
];
const OWNER = {
  bank: 'Attijariwafa Bank',
  rib: '007810000448500030594182',
  swift: 'BCMAMAMC',
  branch: 'RABAT AGDAL, 83 AV. FAL OULD OUMEIR',
  beneficiary: 'M TSOULI YOUNES',
  country: 'MA',
  city: 'RABAT',
};
const SOURCE = { bank: 'PayPal', address: 'PayPal Balance', iban: '', swift: '', beneficiary: 'M TSOULI YOUNES' };
const FX_RATE = 10.2;
const ATTIJARI_PORTAL = 'https://attijaripaypal.attijariwafa.com/PayPal';

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    if (!a.startsWith('--')) continue;
    const [k, ...rest] = a.slice(2).split('=');
    out[k] = rest.join('=') || true;
  }
  return out;
}

async function fetchPendingBatches() {
  const all = [];
  for (const agent of AGENTS) {
    for (let skip = 0; skip < 2000; skip += 50) {
      const url = `https://${agent.name}-${agent.appId.slice(-8)}.base44.app/api/entities/PayoutBatch?limit=50&sort_by=-created_date&skip=${skip}`;
      const r = await fetch(url, { headers: { api_key: agent.key } });
      if (!r.ok) break;
      const rows = await r.json();
      if (rows.length === 0) break;
      all.push(...rows);
      if (rows.length < 50) break;
    }
  }
  // Only batches with BANK_WIRE in batch_id AND live provenance in notes
  return all.filter((b) =>
    String(b.batch_id || '').includes('BANK_WIRE') &&
    String(b.notes || '').includes('LIVE_EVIDENCE'),
  );
}

function buildInstruction(batch, idx) {
  const amtUsd = Number(batch.total_amount || 0);
  const totalMad = amtUsd * FX_RATE;
  const batchN = (batch.batch_id.match(/_(\d+)$/) || [null, idx + 1])[1];
  return {
    type: 'bank_wire_settlement',
    rail: 'bank_wire',
    batch_id: batch.batch_id,
    reference: `WIRE-${batch.batch_id}-${Date.now()}`,
    status: 'ready_for_portal',
    created_at: new Date().toISOString(),
    source: SOURCE,
    destination: { ...OWNER },
    amount: {
      payout_usd: amtUsd,
      total_revenue_usd: amtUsd,
      retained_usd: Number((amtUsd * 0.70).toFixed(2)),
      converted_usd: Number((amtUsd * 0.30).toFixed(2)),
      converted_mad: Number((totalMad * 0.30).toFixed(2)),
      fx_rate: FX_RATE,
    },
    attijari_portal: ATTIJARI_PORTAL,
    attijari_steps: [
      `1. Log into ${ATTIJARI_PORTAL}`,
      `2. Navigate to Virements / Repatriation`,
      `3. Enter wire amount: $${amtUsd.toFixed(2)} USD`,
      `4. Enter beneficiary RIB: ${OWNER.rib}`,
      `5. Enter SWIFT: ${OWNER.swift}`,
      `6. Reference: PAYPAL_BRIDGE_00${batchN}`,
      `7. Confirm 70/30 split (Office des Changes)`,
      `8. Save the bank transaction reference`,
      `9. After portal confirmation, run:`,
      `     node scripts/confirm-bank-wire-receipt.mjs --batch=${batch.batch_id} --receipt-ref=<TXN_REF> --received-by=Owner`,
    ],
    revenue_ids: [batch.batch_id],
    wallet: null,
    source_batch_row_id: batch.id,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = !!args['dry-run'];
  const targetBatch = args.batch;
  if (!existsSync(INSTRUCTIONS_DIR)) await mkdir(INSTRUCTIONS_DIR, { recursive: true });

  const all = await fetchPendingBatches();
  const rec = all.filter((b) => String(b.batch_id || '').includes('BANK_WIRE'));
  const targets = targetBatch ? rec.filter((b) => b.batch_id === targetBatch) : rec;
  if (targets.length === 0) {
    console.error('No RECOVERY_BANK_WIRE batches found.');
    process.exit(1);
  }

  console.log(`=== GENERATE PORTAL INSTRUCTIONS ===`);
  console.log(`Mode: ${dryRun ? 'DRY-RUN' : 'LIVE'}`);
  console.log(`Batches: ${targets.length}\n`);

  let written = 0;
  for (let i = 0; i < targets.length; i++) {
    const b = targets[i];
    const inst = buildInstruction(b, i);
    const fp = path.join(INSTRUCTIONS_DIR, `wire_${b.batch_id}.json`);
    if (!dryRun) {
      await writeFile(fp, JSON.stringify(inst, null, 2) + '\n', 'utf8');
      written++;
      console.log(`  WROTE  ${fp}`);
    } else {
      console.log(`  WOULD-WRITE  ${fp}`);
    }
  }
  console.log(`\n${dryRun ? 'Would write' : 'Wrote'}: ${written} instruction file(s)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
