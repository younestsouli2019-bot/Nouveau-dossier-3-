#!/usr/bin/env node
/**
 * AUTO-SETTLE BANK WIRE — Fully Autonomous
 *
 * 1. Query Base44 for pending BANK_WIRE PayoutBatches
 * 2. Execute each via Wise API (quote → recipient → transfer)
 * 3. Update batch status to completed in Base44
 * 4. Log results
 *
 * Zero manual intervention. Owner hands-free policy.
 */

const AGENTS = [
  { name: 'agent-flow-ai', appId: '6888ac155ebf84dd9855ea98', key: process.env.BASE44_FLOW_API_KEY || '5b4be0fada884ca28142a3279e9880f6' },
  { name: 'agent-swarm', appId: '689afeabf1db9c30efe0bd7e', key: process.env.BASE44_SWARM_API_KEY || 'e599b5b131574c1bae885fc013620739' },
];

const WISE_API = process.env.WISE_ENVIRONMENT === 'live'
  ? 'https://api.wise.com'
  : 'https://api.sandbox.transferwise.tech';

function normIban(v) { return String(v || '').replace(/\s+/g, '').toUpperCase().trim(); }
function normDigits(v) { return String(v || '').replace(/\D+/g, '').trim(); }

// ── Base44 helpers ──

async function fetchPendingBatches(agent) {
  const url = `https://${agent.name}-${agent.appId.slice(-8)}.base44.app/api/entities/PayoutBatch?limit=50&sort_by=-created_date`;
  const res = await fetch(url, { headers: { api_key: agent.key } });
  if (!res.ok) return [];
  const data = await res.json();
  return (Array.isArray(data) ? data : []).filter(b =>
    b.status === 'pending' && (
      b.payout_method === 'BANK_WIRE' ||
      String(b.batch_id || '').includes('BANK_WIRE')
    )
  );
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
    console.error(`  Base44 update failed ${res.status}: ${t}`);
    return false;
  }
  return true;
}

// ── Wise API helpers ──

async function wiseReq(endpoint, opts = {}) {
  const apiKey = process.env.WISE_API_KEY;
  if (!apiKey) throw new Error('Missing WISE_API_KEY');
  const res = await fetch(`${WISE_API}${endpoint}`, {
    ...opts,
    headers: { ...opts.headers, Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Wise ${res.status}: ${err}`);
  }
  return res.json();
}

function getOwnerSpec(currency) {
  const ccy = String(currency || process.env.OWNER_BANK_CURRENCY || 'USD').toUpperCase();
  const name = process.env.OWNER_BENEFICIARY_NAME;
  if (!name) throw new Error('Missing OWNER_BENEFICIARY_NAME');

  if (ccy === 'EUR') {
    const iban = normIban(process.env.OWNER_IBAN);
    if (!iban) throw new Error('Missing OWNER_IBAN for EUR');
    return { currency: 'EUR', name, type: 'iban', details: { iban } };
  }
  if (ccy === 'GBP') {
    const sortCode = normDigits(process.env.OWNER_SORT_CODE);
    const accountNumber = normDigits(process.env.OWNER_ACCOUNT_NUMBER);
    if (!sortCode || !accountNumber) throw new Error('Missing OWNER_SORT_CODE/OWNER_ACCOUNT_NUMBER for GBP');
    return { currency: 'GBP', name, type: 'sort_code', details: { sortCode, accountNumber } };
  }
  const abartn = normDigits(process.env.OWNER_ROUTING_NUMBER);
  const accountNumber = normDigits(process.env.OWNER_ACCOUNT_NUMBER);
  if (!abartn || !accountNumber) throw new Error('Missing OWNER_ROUTING_NUMBER/OWNER_ACCOUNT_NUMBER for USD');
  return { currency: 'USD', name, type: 'aba', details: { abartn, accountNumber, accountType: String(process.env.OWNER_ACCOUNT_TYPE || 'CHECKING').toUpperCase(), legalType: 'PRIVATE' } };
}

async function findOrCreateRecipient(spec) {
  const accounts = await wiseReq(`/v1/accounts?profile=${process.env.WISE_PROFILE_ID}`);
  const existing = accounts.find(a => {
    if (spec.type === 'iban') return a.details?.iban === spec.details.iban;
    if (spec.type === 'sort_code') return a.details?.sortCode === spec.details.sortCode;
    if (spec.type === 'aba') return a.details?.abartn === spec.details.abartn;
    return false;
  });
  if (existing) return existing.id;
  const created = await wiseReq('/v1/accounts', {
    method: 'POST',
    body: JSON.stringify({ profile: parseInt(process.env.WISE_PROFILE_ID), accountHolderName: spec.name, currency: spec.currency, type: 'bank_transfer', details: { ...spec.details } }),
  });
  return created.id;
}

async function executeWire(amount, currency, reference, recipientId, spec) {
  const quote = await wiseReq('/v3/quotes', {
    method: 'POST',
    body: JSON.stringify({ sourceCurrency: currency, targetCurrency: currency, sourceAmount: amount, targetAmount: amount, profile: parseInt(process.env.WISE_PROFILE_ID) }),
  });
  const transfer = await wiseReq('/v1/transfers', {
    method: 'POST',
    body: JSON.stringify({ targetAccount: recipientId, quote: quote.id, description: reference, sourceAccount: parseInt(process.env.WISE_PROFILE_ID) }),
  });
  return { transferId: transfer.id, status: transfer.status, quoteId: quote.id };
}

// ── Main ──

async function main() {
  console.log('=== AUTO-SETTLE BANK WIRES (HANDS-FREE) ===\n');

  // Validate required env
  const required = ['WISE_API_KEY', 'WISE_PROFILE_ID', 'OWNER_BENEFICIARY_NAME', 'OWNER_ACCOUNT_NUMBER'];
  for (const k of required) {
    if (!process.env[k]) { console.error(`FATAL: Missing ${k}`); process.exit(1); }
  }

  const spec = getOwnerSpec();
  const recipientId = await findOrCreateRecipient(spec);
  console.log(`Wise recipient: ${recipientId} (${spec.currency})\n`);

  let totalExecuted = 0;
  let totalFailed = 0;
  const log = [];

  for (const agent of AGENTS) {
    const batches = await fetchPendingBatches(agent);
    if (batches.length === 0) { console.log(`${agent.name}: no pending BANK_WIRE batches`); continue; }

    console.log(`${agent.name}: ${batches.length} pending BANK_WIRE batches\n`);

    for (const b of batches) {
      const amt = b.total_amount || 0;
      const ccy = b.currency || 'USD';
      const ref = `Auto-settle ${b.batch_id} — ${new Date().toISOString().slice(0, 10)}`;

      console.log(`  ${b.batch_id}: $${amt.toFixed(2)} ${ccy}`);

      // Mark processing
      await updateBatch(agent, b.batch_id, { status: 'processing' });

      try {
        const result = await executeWire(amt, ccy, ref, recipientId, spec);
        console.log(`    OK → Transfer ${result.transferId} [${result.status}]`);

        // Mark completed
        await updateBatch(agent, b.batch_id, { status: 'completed', processed_at: new Date().toISOString(), gateway_ref: `wise:${result.transferId}` });
        totalExecuted += amt;
        log.push({ agent: agent.name, batch_id: b.batch_id, amount: amt, transferId: result.transferId, status: result.status, ok: true });
      } catch (e) {
        console.error(`    FAILED: ${e.message}`);
        await updateBatch(agent, b.batch_id, { status: 'failed', notes: `${b.notes || ''} — ${e.message}` });
        totalFailed += amt;
        log.push({ agent: agent.name, batch_id: b.batch_id, amount: amt, error: e.message, ok: false });
      }
    }
    console.log('');
  }

  console.log('=== SUMMARY ===');
  console.log(`Executed: $${totalExecuted.toFixed(2)}`);
  console.log(`Failed:   $${totalFailed.toFixed(2)}`);
  console.log(`Entries:  ${log.length}`);

  const fs = await import('fs/promises');
  await fs.mkdir('dist_rwc', { recursive: true });
  await fs.writeFile('dist_rwc/auto-settle-result.json', JSON.stringify({ timestamp: new Date().toISOString(), totalExecuted, totalFailed, log }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
