#!/usr/bin/env node
/**
 * Validate in-transit BANK_WIRE batches.
 *
 * Lists BANK_WIRE payout batches that were submitted (gateway_ref/processed_at present)
 * but are still `processing` (not confirmed received).
 *
 * Usage:
 *   node scripts/validate-bank-wire-intransit.mjs
 *   node scripts/validate-bank-wire-intransit.mjs --days=2
 */

const AGENTS = [
  { name: 'agent-flow-ai', appId: '6888ac155ebf84dd9855ea98', key: process.env.BASE44_FLOW_API_KEY || '5b4be0fada884ca28142a3279e9880f6' },
  { name: 'agent-swarm', appId: '689afeabf1db9c30efe0bd7e', key: process.env.BASE44_SWARM_API_KEY || 'e599b5b131574c1bae885fc013620739' },
];

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [k, ...rest] = arg.slice(2).split('=');
    out[k] = rest.join('=') || true;
  }
  return out;
}

async function fetchBatches(agent) {
  const url = `https://${agent.name}-${agent.appId.slice(-8)}.base44.app/api/entities/PayoutBatch?limit=100&sort_by=-created_date`;
  const res = await fetch(url, { headers: { api_key: agent.key } });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

function daysBetween(a, b) {
  return Math.floor((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const days = Number.parseInt(String(args.days ?? '0'), 10) || 0;
  const now = new Date();

  console.log('=== BANK WIRE IN-TRANSIT CHECK ===\n');
  if (days > 0) console.log(`Filtering: older than ${days} day(s)\n`);

  let found = 0;
  for (const agent of AGENTS) {
    const batches = await fetchBatches(agent);
    const bankWire = batches.filter((b) => String(b.batch_id || '').includes('BANK_WIRE'));
    const inTransit = bankWire.filter(
      (b) => b.status === 'processing' && (b.gateway_ref || b.processed_at),
    );

    const filtered = inTransit.filter((b) => {
      const ts = b.processed_at ? new Date(b.processed_at) : null;
      if (!ts || Number.isNaN(ts.getTime())) return true;
      return daysBetween(now, ts) >= days;
    });

    if (filtered.length === 0) {
      console.log(`${agent.name}: no in-transit BANK_WIRE batches`);
      continue;
    }

    console.log(`${agent.name}: ${filtered.length} in-transit BANK_WIRE batch(es)\n`);
    for (const b of filtered) {
      const ts = b.processed_at ? new Date(b.processed_at) : null;
      const age = ts && !Number.isNaN(ts.getTime()) ? daysBetween(now, ts) : '?';
      console.log(`  - ${b.batch_id} | $${(b.total_amount || 0).toFixed(2)} ${b.currency || ''} | age=${age}d | ref=${b.gateway_ref || 'n/a'}`);
    }
    console.log('');
    found += filtered.length;
  }

  if (found > 0) {
    console.log('To confirm receipt and close a batch:');
    console.log('  node scripts/confirm-bank-wire-receipt.mjs --batch=<BATCH_ID> --receipt-ref=<REF> --received-by=<NAME> --notes="..."');
    process.exit(1);
  }

  console.log('No in-transit batches found.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

