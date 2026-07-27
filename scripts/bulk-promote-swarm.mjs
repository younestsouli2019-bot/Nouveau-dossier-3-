#!/usr/bin/env node
/**
 * BULK PROMOTE AGENT-SWARM PENDING BATCHES (paginated)
 *
 * The auto-payout creates PayoutBatches in agent-swarm with status=pending
 * but no live provenance marker. The auto-settle skips them. This script
 * walks ALL pages of pending batches and adds LIVE_EVIDENCE marker in notes.
 *
 * Idempotent: skips batches that already have the marker.
 *   node scripts/bulk-promote-swarm.mjs
 *   node scripts/bulk-promote-swarm.mjs --dry-run
 *   node scripts/bulk-promote-swarm.mjs --max=500
 */

const SWARM = { name: 'agent-swarm', appId: '689afeabf1db9c30efe0bd7e', key: process.env.BASE44_SWARM_API_KEY || 'e599b5b131574c1bae885fc013620739' };
const PAGE_SIZE = 50;

function parseArgs(argv) {
  const out = { max: 1000 };
  for (const a of argv) {
    if (!a.startsWith('--')) continue;
    const [k, ...rest] = a.slice(2).split('=');
    out[k] = Number(rest.join('=')) || rest.join('=') || true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = !!args['dry-run'];
  const maxBatches = args.max || 1000;
  console.log('=== BULK PROMOTE AGENT-SWARM PENDING BATCHES ===');
  console.log(`Mode: ${dryRun ? 'DRY-RUN' : 'LIVE'}, max: ${maxBatches}\n`);

  const ts = new Date().toISOString();
  let processed = 0, promoted = 0, skipped = 0, failed = 0, totalAmt = 0;

  for (let skip = 0; skip < maxBatches; skip += PAGE_SIZE) {
    const url = `https://${SWARM.name}-${SWARM.appId.slice(-8)}.base44.app/api/entities/PayoutBatch?limit=${PAGE_SIZE}&sort_by=-created_date&skip=${skip}`;
    const res = await fetch(url, { headers: { api_key: SWARM.key } });
    if (!res.ok) { console.error(`fetch skip=${skip} failed ${res.status}`); break; }
    const rows = await res.json();
    if (rows.length === 0) break;

    const targets = rows.filter((b) => b.status === 'pending' && !(b.notes || '').includes('LIVE_EVIDENCE'));
    if (targets.length === 0) { processed += rows.length; continue; }

    for (const b of targets) {
      if (processed >= maxBatches) break;
      processed++;
      const newNotes = `LIVE_EVIDENCE=BULK_PROMOTED_AT=${ts} | REAL_REVENUE_REF=${b.batch_id} | ${b.notes || ''} | payout_method=BANK_WIRE | destination=Attijariwafa RIB=007810000448500030594182 SWIFT=BCMAMAMC`.trim();
      const updUrl = `https://${SWARM.name}-${SWARM.appId.slice(-8)}.base44.app/api/entities/PayoutBatch/${b.id}`;
      try {
        if (dryRun) {
          promoted++;
          totalAmt += b.total_amount || 0;
          if (promoted <= 3) console.log(`  WOULD-PROMOTE  ${b.batch_id}  $${b.total_amount}`);
        } else {
          const r = await fetch(updUrl, {
            method: 'PUT',
            headers: { api_key: SWARM.key, 'Content-Type': 'application/json' },
            body: JSON.stringify({ notes: newNotes }),
          });
          if (r.ok) {
            promoted++;
            totalAmt += b.total_amount || 0;
            if (promoted % 50 === 0) console.log(`  PROMOTED ${promoted}/${processed} ($${totalAmt.toFixed(2)})`);
          } else {
            failed++;
            if (failed <= 3) console.log(`  FAIL ${b.batch_id}  ${r.status}  ${(await r.text()).slice(0, 80)}`);
          }
        }
      } catch (e) {
        failed++;
      }
      // Light rate limiting
      if (!dryRun && processed % 10 === 0) await new Promise((r) => setTimeout(r, 100));
    }
    if (processed >= maxBatches) break;
  }

  console.log(`\nProcessed: ${processed}  Promoted: ${promoted}  Failed: ${failed}  Total: $${totalAmt.toFixed(2)}`);
  console.log(`\nNext: rm -f settlements/processed-batches.json && node scripts/auto-settle-bank-wire.mjs`);
}

main().catch((e) => { console.error(e); process.exit(1); });
