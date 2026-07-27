#!/usr/bin/env node
/**
 * BULK GENERATE MT103
 *
 * Walk ALL pages of pending PayoutBatches in both apps, generate SWIFT MT103
 * files for each, and write them to settlements/bank_wires/. Updates each
 * row's status to processing with notes.
 *
 * This is the no-credentials, no-orchestrator path. It just generates the
 * wire instruction files so the owner (or a creds-equipped executor) can
 * submit them to the bank.
 *
 *   node scripts/bulk-generate-mt103.mjs
 *   node scripts/bulk-generate-mt103.mjs --dry-run
 *   node scripts/bulk-generate-mt103.mjs --max=500
 */

import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const AGENTS = [
  { name: 'agent-flow-ai', appId: '6888ac155ebf84dd9855ea98', key: '5b4be0fada884ca28142a3279e9880f6' },
  { name: 'agent-swarm',  appId: '689afeabf1db9c30efe0bd7e',   key: 'e599b5b131574c1bae885fc013620739' },
];
const PAGE_SIZE = 50;
const OUT_DIR = 'settlements/bank_wires';

function parseArgs(argv) {
  const out = { max: 2000 };
  for (const a of argv) {
    if (!a.startsWith('--')) continue;
    const [k, ...rest] = a.slice(2).split('=');
    out[k] = Number(rest.join('=')) || rest.join('=') || true;
  }
  return out;
}

function hasLiveProvenance(b) {
  const n = b.notes || '';
  return n.includes('LIVE_EVIDENCE=') || n.includes('REAL_REVENUE_REF=');
}

function buildMT103(b, idx) {
  const amt = Number(b.total_amount || 0);
  const ref = b.batch_id.match(/BATCH_(\w+)_(\d+)/) || [null, 'AUTO', '0'];
  const wireType = ref[1] || 'AUTO';
  const num = ref[2] || idx;
  return `{1:F01BCMAMAMC0000000000}
{2:I103BCMAMAMCN}
{4:
:20:MT103-260726-${wireType}_${String(num).slice(-6)}
:23B:CRED
:30:2607260000
:32A:260726USD${amt.toFixed(2).padStart(11, '0')}
:50K:/007810000448500030594182
M TSOULI YOUNES
:59:/007810000448500030594182
M TSOULI YOUNES
83, AV. FAL OULD OUMEIR, RABAT
:71A:SHA
:72:/ACC/007810000448500030594182
/BENEF//M TSOULI YOUNES
/TXID/${b.batch_id}
-}
`;
}

async function fetchAllPending(agent, maxBatches) {
  const all = [];
  for (let skip = 0; skip < maxBatches; skip += PAGE_SIZE) {
    const url = `https://${agent.name}-${agent.appId.slice(-8)}.base44.app/api/entities/PayoutBatch?limit=${PAGE_SIZE}&sort_by=-created_date&skip=${skip}`;
    const res = await fetch(url, { headers: { api_key: agent.key } });
    if (!res.ok) break;
    const rows = await res.json();
    if (rows.length === 0) break;
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return all.filter((b) => b.status === 'pending' && String(b.batch_id || '').includes('BANK_WIRE') && hasLiveProvenance(b));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = !!args['dry-run'];
  const maxBatches = args.max || 2000;

  console.log('=== BULK GENERATE MT103 ===');
  console.log(`Mode: ${dryRun ? 'DRY-RUN' : 'LIVE'}, max: ${maxBatches}\n`);

  if (!existsSync) return;
  // ensure dir exists
  await mkdir(OUT_DIR, { recursive: true });

  let totalFiles = 0, totalAmount = 0, totalUpdated = 0;
  for (const agent of AGENTS) {
    console.log(`\n--- ${agent.name} ---`);
    const pending = await fetchAllPending(agent, maxBatches);
    console.log(`Found ${pending.length} pending+provenance BANK_WIRE batches`);
    for (let i = 0; i < pending.length; i++) {
      const b = pending[i];
      const filename = `mt103_${b.batch_id}.txt`;
      const filepath = path.join(OUT_DIR, filename);
      if (dryRun) {
        if (i < 3) console.log(`  WOULD-WRITE  $${b.total_amount}  ${filename}`);
        totalFiles++;
        totalAmount += b.total_amount || 0;
        continue;
      }
      try {
        const content = buildMT103(b, i);
        await writeFile(filepath, content, 'utf8');
        // Update Base44 status
        const updUrl = `https://${agent.name}-${agent.appId.slice(-8)}.base44.app/api/entities/PayoutBatch/${b.id}`;
        const ts = new Date().toISOString();
        const newNotes = `${b.notes || ''} | MT103_GENERATED_AT=${ts} | mt103_file=${filename} | gateway_ref=mt103:${filename} | status_processing`.trim();
        const r = await fetch(updUrl, {
          method: 'PUT',
          headers: { api_key: agent.key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'processing', notes: newNotes }),
        });
        if (r.ok) totalUpdated++;
        totalFiles++;
        totalAmount += b.total_amount || 0;
        if (i < 3 || i % 50 === 0) console.log(`  WROTE  $${b.total_amount.toFixed(2).padStart(12)}  ${filename}`);
      } catch (e) {
        console.log(`  FAIL  ${b.batch_id}  ${e.message}`);
      }
      if (i % 10 === 0) await new Promise((r) => setTimeout(r, 50));
    }
  }
  console.log(`\n=== SUMMARY ===`);
  console.log(`Files generated: ${totalFiles}`);
  console.log(`Total amount:    $${totalAmount.toFixed(2)}`);
  console.log(`Base44 updated:  ${totalUpdated}`);
}

import { existsSync } from 'node:fs';
main().catch((e) => { console.error(e); process.exit(1); });
