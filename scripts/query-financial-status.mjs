#!/usr/bin/env node
/**
 * Query Financial Status — Base44 API
 * Queries RevenueEvent, TransactionLog, PayoutBatch from both Base44 apps
 * and prints a summary to stdout.
 */

const AGENTS = [
  { name: 'agent-flow-ai', appId: '6888ac155ebf84dd9855ea98', key: process.env.BASE44_FLOW_API_KEY || '5b4be0fada884ca28142a3279e9880f6' },
  { name: 'agent-swarm',   appId: '689afeabf1db9c30efe0bd7e', key: process.env.BASE44_SWARM_API_KEY || 'e599b5b131574c1bae885fc013620739' },
];

const ENTITIES = ['RevenueEvent', 'TransactionLog', 'PayoutBatch', 'PayoutRecipient', 'RevenueStream'];

async function queryEntity(agent, entity) {
  const base = `https://${agent.name}-${agent.appId.slice(-8)}.base44.app/api/entities/${entity}`;
  const params = new URLSearchParams({ limit: '20', sort_by: '-created_date' });
  const url = `${base}?${params}`;
  try {
    const res = await fetch(url, { headers: { api_key: agent.key } });
    if (!res.ok) return { entity, error: `${res.status} ${res.statusText}` };
    const data = await res.json();
    return { entity, records: Array.isArray(data) ? data : [data], count: Array.isArray(data) ? data.length : 1 };
  } catch (e) {
    return { entity, error: e.message };
  }
}

async function main() {
  const results = {};
  for (const agent of AGENTS) {
    results[agent.name] = {};
    for (const entity of ENTITIES) {
      results[agent.name][entity] = await queryEntity(agent, entity);
    }
  }

  // Summary
  console.log('=== FINANCIAL STATUS ===\n');
  for (const [agentName, entities] of Object.entries(results)) {
    console.log(`--- ${agentName} ---`);
    for (const [entity, data] of Object.entries(entities)) {
      if (data.error) {
        console.log(`  ${entity}: ERROR - ${data.error}`);
        continue;
      }
      console.log(`  ${entity}: ${data.count} records`);
      if (entity === 'RevenueEvent' && data.records?.length) {
        const total = data.records.reduce((s, r) => s + (r.amount || 0), 0);
        console.log(`    Total (last ${data.count}): $${total.toFixed(2)}`);
      }
      if (entity === 'TransactionLog' && data.records?.length) {
        const total = data.records.reduce((s, r) => s + (r.amount || 0), 0);
        console.log(`    Total withdrawals (last ${data.count}): $${total.toFixed(2)}`);
      }
      if (entity === 'PayoutBatch' && data.records?.length) {
        const bankWire = data.records.filter((b) => String(b.batch_id || '').includes('BANK_WIRE'));
        const inTransit = bankWire.filter((b) => b.status === 'processing' && (b.gateway_ref || b.processed_at));
        const confirmed = bankWire.filter((b) => b.status === 'completed');
        const inTransitAmt = inTransit.reduce((s, b) => s + (b.total_amount || 0), 0);
        const confirmedAmt = confirmed.reduce((s, b) => s + (b.total_amount || 0), 0);

        if (bankWire.length) {
          console.log(`    BANK_WIRE in-transit: ${inTransit.length} ($${inTransitAmt.toFixed(2)})`);
          console.log(`    BANK_WIRE confirmed:  ${confirmed.length} ($${confirmedAmt.toFixed(2)})`);
        }
        for (const r of data.records.slice(0, 3)) {
          console.log(`    Batch ${r.batch_id}: $${r.total_amount} ${r.currency} [${r.status}]`);
        }
      }
      if (entity === 'RevenueStream' && data.records?.length) {
        let totalAvail = 0;
        for (const r of data.records) {
          totalAvail += r.available_for_payout || 0;
          console.log(`    ${r.name}: $${(r.available_for_payout || 0).toFixed(2)} available [${r.payout_status}]`);
        }
        console.log(`    Total available: $${totalAvail.toFixed(2)}`);
      }
    }
    console.log('');
  }

  // Write output for CI
  const output = JSON.stringify(results, null, 2);
  const fs = await import('fs/promises');
  await fs.mkdir('dist_rwc', { recursive: true });
  await fs.writeFile('dist_rwc/financial-status.json', output);
  console.log('Written to dist_rwc/financial-status.json');
}

main().catch(e => { console.error(e); process.exit(1); });
