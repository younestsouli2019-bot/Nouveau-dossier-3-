#!/usr/bin/env node
/**
 * Create Payout Batch via Base44 API
 * Creates a PayoutBatch entity in the agent-swarm Base44 app.
 *
 * Env vars:
 *   AMOUNT, CURRENCY, PAYOUT_METHOD (default: BANK_WIRE)
 *   RECIPIENT_NAME, RECIPIENT_EMAIL, RECIPIENT_TYPE (default: owner)
 */

const AGENT = { name: 'agent-swarm', appId: '689afeabf1db9c30efe0bd7e', key: process.env.BASE44_SWARM_API_KEY || 'e599b5b131574c1bae885fc013620739' };

async function createBatch(data) {
  const url = `https://${AGENT.name}-${AGENT.appId.slice(-8)}.base44.app/api/entities/PayoutBatch`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { api_key: AGENT.key, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Base44 API error ${res.status}: ${text}`);
  }
  return res.json();
}

async function main() {
  const amount = parseFloat(process.env.AMOUNT || '0');
  const currency = process.env.CURRENCY || 'USD';
  const payoutMethod = process.env.PAYOUT_METHOD || 'BANK_WIRE';
  const recipientName = process.env.RECIPIENT_NAME || 'Younes Tsouli';
  const recipientEmail = process.env.RECIPIENT_EMAIL || 'younestsouli2019@gmail.com';
  const recipientType = process.env.RECIPIENT_TYPE || 'owner';

  if (!amount || amount <= 0) {
    console.error('ERROR: Set AMOUNT env var to the payout amount');
    process.exit(1);
  }

  const batchId = `BATCH_${payoutMethod}_${Date.now()}`;
  const payload = {
    batch_id: batchId,
    status: 'pending',
    total_amount: amount,
    currency,
    payout_method: payoutMethod,
    notes: `Recipient: ${recipientEmail} (${recipientType}) — Revenue settlement: owner direct payout`,
  };

  console.log(`Creating payout batch: ${batchId}`);
  console.log(`  Amount: $${amount.toFixed(2)} ${currency}`);
  console.log(`  Method: ${payoutMethod}`);
  console.log(`  Recipient: ${recipientName} (${recipientEmail})`);

  const result = await createBatch(payload);
  console.log('\nPayout batch created:');
  console.log(JSON.stringify(result, null, 2));

  const fs = await import('fs/promises');
  await fs.mkdir('dist_rwc', { recursive: true });
  await fs.writeFile(`dist_rwc/payout-batch-${batchId}.json`, JSON.stringify(result, null, 2));
  console.log(`\nWritten to dist_rwc/payout-batch-${batchId}.json`);
}

main().catch(e => { console.error(e); process.exit(1); });
