#!/usr/bin/env node
/**
 * Confirm BANK_WIRE receipt — Manual confirmation step.
 *
 * Why:
 * - auto-settle-bank-wire submits the wire and stores gateway_ref, but leaves status as `processing`
 * - this script marks the batch `completed` only after receipt is actually verified
 *
 * Usage:
 *   node scripts/confirm-bank-wire-receipt.mjs --batch=BANK_WIRE_... --receipt-ref=ATTJ-... --received-by=Owner
 *
 * Optional:
 *   --notes="Bank statement shows credit"
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

async function fetchBatch(agent, batchId) {
  const url = `https://${agent.name}-${agent.appId.slice(-8)}.base44.app/api/entities/PayoutBatch?limit=50&sort_by=-created_date`;
  const res = await fetch(url, { headers: { api_key: agent.key } });
  if (!res.ok) return null;
  const data = await res.json();
  const records = Array.isArray(data) ? data : [];
  return records.find((b) => b.batch_id === batchId) || null;
}

async function updateBatch(agent, batchId, patch) {
  const url = `https://${agent.name}-${agent.appId.slice(-8)}.base44.app/api/entities/PayoutBatch/${batchId}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { api_key: agent.key, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Base44 update failed ${res.status}: ${t}`);
  }
  return true;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const batchId = args.batch || args.batch_id;
  const receiptRef = args['receipt-ref'] || args.receipt_ref || '';
  const receivedBy = args['received-by'] || args.received_by || '';
  const notes = args.notes ? String(args.notes) : '';

  if (!batchId) {
    console.error('Missing --batch=<BATCH_ID>');
    process.exit(1);
  }
  if (!receiptRef || !receivedBy) {
    console.error('Missing required receipt metadata: --receipt-ref=... and --received-by=...');
    process.exit(1);
  }

  console.log(`=== CONFIRM BANK WIRE RECEIPT ===`);
  console.log(`Batch: ${batchId}`);
  console.log(`Receipt ref: ${receiptRef}`);
  console.log(`Received by: ${receivedBy}`);
  if (notes) console.log(`Notes: ${notes}`);
  console.log('');

  for (const agent of AGENTS) {
    const batch = await fetchBatch(agent, batchId);
    if (!batch) continue;

    if (batch.status !== 'processing') {
      console.error(`Found batch in ${agent.name}, but status is "${batch.status}" (expected "processing").`);
      process.exit(1);
    }
    if (!batch.gateway_ref) {
      console.error(`Found batch in ${agent.name}, but gateway_ref is missing. Refuse to confirm.`);
      process.exit(1);
    }

    const confirmedAt = new Date().toISOString();
    const noteSuffix = `Receipt confirmed: ${receiptRef} by ${receivedBy} at ${confirmedAt}${notes ? ` — ${notes}` : ''}`;
    const newNotes = `${batch.notes || ''}${batch.notes ? ' ' : ''}${noteSuffix}`.trim();

    await updateBatch(agent, batchId, {
      status: 'completed',
      confirmed_at: confirmedAt,
      receipt_ref: receiptRef,
      received_by: receivedBy,
      notes: newNotes,
    });

    console.log(`OK: Marked completed in ${agent.name}`);
    return;
  }

  console.error('Batch not found in either Base44 agent.');
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

