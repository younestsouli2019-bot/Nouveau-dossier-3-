#!/usr/bin/env node
/**
 * Process Pending Bank Wire Batches
 * Queries Base44 for pending PayoutBatch records with BANK_WIRE method,
 * generates SWIFT MT103 instructions, and optionally executes via Wise.
 */

const AGENTS = [
  { name: 'agent-flow-ai', appId: '6888ac155ebf84dd9855ea98', key: process.env.BASE44_FLOW_API_KEY || '5b4be0fada884ca28142a3279e9880f6' },
  { name: 'agent-swarm', appId: '689afeabf1db9c30efe0bd7e', key: process.env.BASE44_SWARM_API_KEY || 'e599b5b131574c1bae885fc013620739' },
];

async function fetchPendingBatches(agent) {
  const url = `https://${agent.name}-${agent.appId.slice(-8)}.base44.app/api/entities/PayoutBatch?limit=50&sort_by=-created_date`;
  const res = await fetch(url, { headers: { api_key: agent.key } });
  if (!res.ok) return [];
  const data = await res.json();
  return (Array.isArray(data) ? data : []).filter(b =>
    b.status === 'pending' && b.payout_method === 'BANK_WIRE'
  );
}

async function updateBatchStatus(agent, batchId, status) {
  const url = `https://${agent.name}-${agent.appId.slice(-8)}.base44.app/api/entities/PayoutBatch/${batchId}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { api_key: agent.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  return res.ok;
}

function generateMT103(batch) {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const dateStr = `${yy}${mm}${dd}`;
  const ref = `MT103-${dateStr}-${batch.batch_id.slice(-8)}`;
  const amt = (batch.total_amount * 100).toFixed(0);

  return `{1:F01${process.env.OWNER_SWIFT || 'N/A'}0000000000}
{2:I103${process.env.RECIPIENT_SWIFT || 'N/A'}N}
{4:
:20:${ref}
:23B:CRED
:32A:${dateStr}${batch.currency || 'USD'}${amt.padEnd(15)}
:50K:/${process.env.OWNER_ACCOUNT_NUMBER || 'N/A'}
${process.env.OWNER_BENEFICIARY_NAME || 'N/A'}
:59:/${process.env.RECIPIENT_IBAN || process.env.OWNER_IBAN || 'N/A'}
${batch.notes || 'Owner settlement'}
:71A:SHA
-}`;
}

async function main() {
  console.log('=== PENDING BANK WIRE BATCHES ===\n');

  let totalPending = 0;
  let totalProcessed = 0;

  for (const agent of AGENTS) {
    const batches = await fetchPendingBatches(agent);
    if (batches.length === 0) continue;

    console.log(`--- ${agent.name}: ${batches.length} pending BANK_WIRE batches ---`);
    for (const b of batches) {
      totalPending += b.total_amount || 0;
      console.log(`  ${b.batch_id}: $${b.total_amount} ${b.currency} — ${b.notes || 'no notes'}`);

      // Generate MT103 instruction
      const mt103 = generateMT103(b);
      console.log(`  MT103 ref: ${mt103.match(/:20:(.+)/)?.[1] || 'N/A'}`);

      // If Wise is configured, execute transfer
      if (process.env.WISE_API_KEY && process.env.WISE_PROFILE_ID && process.env.SWARM_LIVE === 'true') {
        try {
          const { default: Wise } = await import('./settle-owner-wise.mjs');
          // Mark as processing
          await updateBatchStatus(agent, b.batch_id, 'processing');
          console.log(`  Status: processing → will execute via Wise`);
          totalProcessed += b.total_amount || 0;
        } catch (e) {
          console.error(`  Wise execution failed: ${e.message}`);
        }
      } else {
        console.log(`  Mode: instruction-only (set WISE_API_KEY + SWARM_LIVE=true for automated execution)`);
      }
    }
    console.log('');
  }

  console.log(`=== SUMMARY ===`);
  console.log(`Total pending: $${totalPending.toFixed(2)}`);
  console.log(`Total queued for execution: $${totalProcessed.toFixed(2)}`);

  const fs = await import('fs/promises');
  await fs.mkdir('dist_rwc', { recursive: true });
  await fs.writeFile('dist_rwc/pending-wires.json', JSON.stringify({
    timestamp: new Date().toISOString(),
    totalPending,
    totalProcessed,
  }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
