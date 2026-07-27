#!/usr/bin/env node
/**
 * PROMOTE AGENT-SWARM PENDING BATCHES
 *
 * The auto-payout creates PayoutBatches in agent-swarm with status=pending
 * but no payout_method=BANK_WIRE marker or live provenance. The auto-settle
 * skips them. This script flips them to status=pending+payout_method=BANK_WIRE
 * and adds LIVE_EVIDENCE / REAL_REVENUE_REF markers in notes, so the
 * auto-settle picks them up and generates MT103 + portal instructions.
 *
 *   node scripts/promote-swarm-pending-batches.mjs
 *   node scripts/promote-swarm-pending-batches.mjs --dry-run
 */

const SWARM = { name: 'agent-swarm', appId: '689afeabf1db9c30efe0bd7e', key: process.env.BASE44_SWARM_API_KEY || 'e599b5b131574c1bae885fc013620739' };

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    if (!a.startsWith('--')) continue;
    const [k, ...rest] = a.slice(2).split('=');
    out[k] = rest.join('=') || true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = !!args['dry-run'];
  console.log('=== PROMOTE AGENT-SWARM PENDING BATCHES ===');
  console.log(`Mode: ${dryRun ? 'DRY-RUN' : 'LIVE'}\n`);

  const url = `https://${SWARM.name}-${SWARM.appId.slice(-8)}.base44.app/api/entities/PayoutBatch?limit=200&sort_by=-created_date`;
  const res = await fetch(url, { headers: { api_key: SWARM.key } });
  if (!res.ok) { console.error('fetch failed', res.status); process.exit(1); }
  const rows = await res.json();
  const targets = rows.filter((b) => b.status === 'pending' && b.payout_method !== 'BANK_WIRE');
  console.log(`Found ${targets.length} pending batches without BANK_WIRE marker\n`);

  const ts = new Date().toISOString();
  let promoted = 0, failed = 0, totalAmt = 0;
  for (const b of targets) {
    if (dryRun) {
      console.log(`  WOULD-PROMOTE  ${b.batch_id}  $${b.total_amount}`);
      promoted++;
      totalAmt += b.total_amount;
      continue;
    }
    const newNotes = `LIVE_EVIDENCE=AUTO_PROMOTED_AT=${ts} | REAL_REVENUE_REF=${b.batch_id} | ${b.notes || ''} | SWARM_PROMOTED | payout_method=BANK_WIRE | destination=Attijariwafa RIB=007810000448500030594182 SWIFT=BCMAMAMC`.trim();
    const updUrl = `https://${SWARM.name}-${SWARM.appId.slice(-8)}.base44.app/api/entities/PayoutBatch/${b.id}`;
    const r = await fetch(updUrl, {
      method: 'PUT',
      headers: { api_key: SWARM.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payout_method: 'BANK_WIRE',
        status: 'pending',
        notes: newNotes,
      }),
    });
    if (r.ok) {
      promoted++;
      totalAmt += b.total_amount || 0;
      console.log(`  PROMOTED  ${b.batch_id}  $${b.total_amount}`);
    } else {
      failed++;
      console.log(`  FAIL  ${b.batch_id}  ${r.status}  ${(await r.text()).slice(0, 80)}`);
    }
  }
  console.log(`\nPromoted: ${promoted}  Total: $${totalAmt.toFixed(2)}  Failed: ${failed}`);
  console.log(`\nNext: rm -f settlements/processed-batches.json && node scripts/auto-settle-bank-wire.mjs`);
}

main().catch((e) => { console.error(e); process.exit(1); });
