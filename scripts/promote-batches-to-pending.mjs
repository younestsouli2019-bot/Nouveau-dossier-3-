#!/usr/bin/env node
/**
 * PROMOTE BATCHES TO PENDING
 *
 * Flips status=processing → status=pending for the 4 false-completed
 * RECOVERY_BANK_WIRE batches that were never actually submitted.
 * Adds a PROMOTED_TO_PENDING_AT=<ts> note marker.
 */

const FLOW = { name: 'agent-flow-ai', appId: '6888ac155ebf84dd9855ea98', key: process.env.BASE44_FLOW_API_KEY || '5b4be0fada884ca28142a3279e9880f6' };

async function main() {
  const url = `https://${FLOW.name}-${FLOW.appId.slice(-8)}.base44.app/api/entities/PayoutBatch?limit=200&sort_by=-created_date`;
  const res = await fetch(url, { headers: { api_key: FLOW.key } });
  if (!res.ok) { console.error('fetch failed', res.status); process.exit(1); }
  const rows = await res.json();
  const targets = rows.filter((b) => String(b.batch_id || '').includes('RECOVERY_BANK_WIRE') && b.status === 'processing');
  console.log('=== PROMOTE BATCHES TO PENDING ===');
  console.log(`Found ${targets.length} candidates\n`);

  const ts = new Date().toISOString();
  let promoted = 0, failed = 0;
  for (const b of targets) {
    const updUrl = `https://${FLOW.name}-${FLOW.appId.slice(-8)}.base44.app/api/entities/PayoutBatch/${b.id}`;
    const newNotes = `${b.notes || ''} | PROMOTED_TO_PENDING_AT=${ts} | was_status=processing now_status=pending`.trim();
    const r = await fetch(updUrl, {
      method: 'PUT',
      headers: { api_key: FLOW.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'pending', notes: newNotes }),
    });
    if (r.ok) {
      promoted++;
      console.log(`  PROMOTED  ${b.batch_id}`);
    } else {
      failed++;
      console.log(`  FAIL  ${b.batch_id}  ${r.status}  ${(await r.text()).slice(0, 80)}`);
    }
  }
  console.log(`\nPromoted: ${promoted}, Failed: ${failed}`);
  console.log('\nNext: node scripts/auto-settle-bank-wire.mjs (will pick them up)');
}

main().catch((e) => { console.error(e); process.exit(1); });
