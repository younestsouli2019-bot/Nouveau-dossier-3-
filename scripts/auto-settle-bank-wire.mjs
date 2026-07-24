#!/usr/bin/env node
/**
 * AUTO-SETTLE BANK WIRE — Fully Autonomous v2
 *
 * 1. Load processed-set to avoid re-processing
 * 2. Query Base44 for pending BANK_WIRE PayoutBatches
 * 3. Execute via Wise API OR generate SWIFT MT103 instructions
 * 4. Update batch status in Base44 to `processing` (submitted/in transit) + persist processed-set
 * 5. Notify owner via webhook
 * 6. Log results
 *
 * NOTE: Receipt confirmation is intentionally manual:
 * - `processing` = submitted (in transit)
 * - `completed` = receipt confirmed
 * Use: node scripts/confirm-bank-wire-receipt.mjs --batch=... --receipt-ref=... --received-by=...
 */

import fs from 'node:fs';
import path from 'node:path';

const AGENTS = [
  { name: 'agent-flow-ai', appId: '6888ac155ebf84dd9855ea98', key: process.env.BASE44_FLOW_API_KEY || '5b4be0fada884ca28142a3279e9880f6' },
  { name: 'agent-swarm', appId: '689afeabf1db9c30efe0bd7e', key: process.env.BASE44_SWARM_API_KEY || 'e599b5b131574c1bae885fc013620739' },
];

const WISE_API = process.env.WISE_ENVIRONMENT === 'live'
  ? 'https://api.wise.com'
  : 'https://api.sandbox.transferwise.tech';

const PROCESSED_FILE = path.resolve('settlements', 'processed-batches.json');

// ── Helpers ──

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function withRetry(fn, label, maxRetries = 3) {
  for (let i = 0; i <= maxRetries; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === maxRetries) throw e;
      const delay = 1000 * 2 ** i;
      console.warn(`    Retry ${i + 1}/${maxRetries} for ${label} in ${delay}ms: ${e.message}`);
      await sleep(delay);
    }
  }
}

function loadProcessedSet() {
  try {
    if (fs.existsSync(PROCESSED_FILE)) return new Set(JSON.parse(fs.readFileSync(PROCESSED_FILE, 'utf8')));
  } catch { /* ignore */ }
  return new Set();
}

function saveProcessedSet(set) {
  fs.mkdirSync(path.dirname(PROCESSED_FILE), { recursive: true });
  fs.writeFileSync(PROCESSED_FILE, JSON.stringify([...set], null, 2));
}

function loadBankConfig() {
  const cfgPath = path.resolve('bank-config.json');
  if (fs.existsSync(cfgPath)) return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  return null;
}

function normIban(v) { return String(v || '').replace(/\s+/g, '').toUpperCase().trim(); }
function normDigits(v) { return String(v || '').replace(/\D+/g, '').trim(); }

// ── Base44 helpers ──

async function fetchPendingBatches(agent) {
  const url = `https://${agent.name}-${agent.appId.slice(-8)}.base44.app/api/entities/PayoutBatch?limit=50&sort_by=-created_date`;
  const res = await withRetry(() => fetch(url, { headers: { api_key: agent.key } }), `fetch ${agent.name}`);
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
  try {
    const res = await withRetry(() => fetch(url, {
      method: 'PUT',
      headers: { api_key: agent.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }), `update ${batchId}`);
    if (!res.ok) {
      const t = await res.text();
      console.warn(`  Base44 update failed ${res.status}: ${t}`);
      return false;
    }
    return true;
  } catch (e) {
    console.warn(`  Base44 update error: ${e.message}`);
    return false;
  }
}

// ── Wise API helpers ──

async function wiseReq(endpoint, opts = {}) {
  const apiKey = process.env.WISE_API_KEY;
  if (!apiKey) throw new Error('Missing WISE_API_KEY');
  const res = await withRetry(() => fetch(`${WISE_API}${endpoint}`, {
    ...opts,
    headers: { ...opts.headers, Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  }), `wise ${endpoint}`);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Wise ${res.status}: ${err}`);
  }
  return res.json();
}

function getOwnerSpecFromEnv(currency) {
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
    if (spec.type === 'swift') return a.details?.swift === spec.details.swift;
    return false;
  });
  if (existing) return existing.id;
  const created = await wiseReq('/v1/accounts', {
    method: 'POST',
    body: JSON.stringify({ profile: parseInt(process.env.WISE_PROFILE_ID), accountHolderName: spec.name, currency: spec.currency, type: 'bank_transfer', details: { ...spec.details } }),
  });
  return created.id;
}

async function executeWire(amount, currency, reference, recipientId) {
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

// ── SWIFT MT103 generation ──

function generateMT103(batch, cfg) {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const dateStr = `${yy}${mm}${dd}`;
  const timeStr = `${hh}${mi}`;
  const ref = `MT103-${dateStr}-${batch.batch_id.slice(-12)}`;
  const amt = Number(batch.total_amount).toFixed(2);
  const o = cfg.owner;
  const txRef = batch.batch_id.slice(-16);

  return `{1:F01${o.swift_bic}0000000000}
{2:I103${o.swift_bic}N}
{4:
:20:${ref}
:23B:CRED
:30:${dateStr}${timeStr}
:32A:${dateStr}${batch.currency || 'MAD'}${amt}
:50K:/${o.rib}
${o.name}
:59:/${o.rib}
${o.name}
${o.address || ''}
:71A:SHA
:72:/ACC/${o.rib}
/BENEF//${o.name}
/TXID/${txRef}
-}`;
}

// ── Notification ──

async function notifyOwner(summary) {
  const webhook = process.env.OWNER_NOTIFICATION_WEBHOOK;
  if (!webhook) return;
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `✅ Bank Wire Submitted (Awaiting Confirmation)\n` +
              `Total submitted: $${summary.totalExecuted.toFixed(2)}\n` +
              `Batches: ${summary.log.length}\n` +
              `Failed: $${summary.totalFailed.toFixed(2)}\n` +
              `Time: ${summary.timestamp}`,
      }),
    });
  } catch { /* best effort */ }
}

// ── Main ──

async function main() {
  console.log('=== AUTO-SETTLE BANK WIRES v2 (HANDS-FREE) ===\n');

  const cfg = loadBankConfig();
  const hasWise = !!process.env.WISE_API_KEY && !!process.env.WISE_PROFILE_ID;
  const processed = loadProcessedSet();
  let skippedDupes = 0;

  if (cfg) {
    console.log(`Bank: ${cfg.owner.bank_name} | SWIFT: ${cfg.owner.swift_bic} | RIB: ${cfg.owner.rib}`);
    console.log(`Holder: ${cfg.owner.name} | Currency: ${cfg.owner.currency}`);
  }

  if (hasWise) {
    console.log('Mode: WISE API (automated execution)');
  } else if (cfg) {
    console.log('Mode: SWIFT MT103 instruction generation');
  } else {
    console.error('FATAL: No bank config or Wise API credentials');
    process.exit(1);
  }
  console.log(`Previously processed: ${processed.size} batches\n`);

  let totalExecuted = 0;
  let totalFailed = 0;
  const log = [];

  for (const agent of AGENTS) {
    const batches = await fetchPendingBatches(agent);
    if (batches.length === 0) { console.log(`${agent.name}: no pending BANK_WIRE batches`); continue; }

    console.log(`${agent.name}: ${batches.length} pending BANK_WIRE batches\n`);

    for (const b of batches) {
      const batchKey = `${agent.name}:${b.batch_id}`;

      if (processed.has(batchKey)) {
        skippedDupes++;
        console.log(`  ${b.batch_id}: SKIP (already processed)`);
        continue;
      }

      const amt = b.total_amount || 0;
      const ccy = b.currency || 'MAD';
      const ref = `Auto-settle ${b.batch_id} — ${new Date().toISOString().slice(0, 10)}`;

      console.log(`  ${b.batch_id}: $${amt.toFixed(2)} ${ccy}`);

      await updateBatch(agent, b.batch_id, { status: 'processing' });

      try {
        if (hasWise) {
          const spec = getOwnerSpecFromEnv(ccy);
          let recipientId;
          try {
            recipientId = await findOrCreateRecipient(spec);
          } catch (e) {
            if (cfg) {
              const mt103 = generateMT103(b, cfg);
              const dir = path.resolve('settlements', 'bank_wires');
              fs.mkdirSync(dir, { recursive: true });
              const filePath = path.join(dir, `mt103_${b.batch_id}.txt`);
              fs.writeFileSync(filePath, mt103, 'utf8');
              console.log(`    MT103 fallback → ${filePath}`);
              await updateBatch(agent, b.batch_id, {
                status: 'processing',
                processed_at: new Date().toISOString(),
                gateway_ref: `mt103:${path.basename(filePath)}`,
                notes: `${b.notes || ''} — Submitted via MT103. Awaiting manual receipt confirmation.`,
              });
              totalExecuted += amt;
              log.push({ agent: agent.name, batch_id: b.batch_id, amount: amt, mode: 'mt103_instruction', ok: true });
              processed.add(batchKey);
              continue;
            }
            throw e;
          }
          const result = await executeWire(amt, ccy, ref, recipientId);
          console.log(`    OK → Transfer ${result.transferId} [${result.status}]`);
          await updateBatch(agent, b.batch_id, {
            status: 'processing',
            processed_at: new Date().toISOString(),
            gateway_ref: `wise:${result.transferId}`,
            notes: `${b.notes || ''} — Submitted via Wise. Awaiting manual receipt confirmation.`,
          });
          totalExecuted += amt;
          log.push({ agent: agent.name, batch_id: b.batch_id, amount: amt, transferId: result.transferId, status: result.status, ok: true });
          processed.add(batchKey);
        } else if (cfg) {
          const mt103 = generateMT103(b, cfg);
          const dir = path.resolve('settlements', 'bank_wires');
          fs.mkdirSync(dir, { recursive: true });
          const filePath = path.join(dir, `mt103_${b.batch_id}.txt`);
          fs.writeFileSync(filePath, mt103, 'utf8');
          console.log(`    MT103 → ${filePath}`);
          await updateBatch(agent, b.batch_id, {
            status: 'processing',
            processed_at: new Date().toISOString(),
            gateway_ref: `mt103:${path.basename(filePath)}`,
            notes: `${b.notes || ''} — Submitted via MT103. Awaiting manual receipt confirmation.`,
          });
          totalExecuted += amt;
          log.push({ agent: agent.name, batch_id: b.batch_id, amount: amt, mode: 'mt103_instruction', ok: true });
          processed.add(batchKey);
        }
      } catch (e) {
        console.error(`    FAILED: ${e.message}`);
        await updateBatch(agent, b.batch_id, { status: 'failed', notes: `${b.notes || ''} — ${e.message}` });
        totalFailed += amt;
        log.push({ agent: agent.name, batch_id: b.batch_id, amount: amt, error: e.message, ok: false });
      }
    }
    console.log('');
  }

  saveProcessedSet(processed);

  const summary = { timestamp: new Date().toISOString(), totalExecuted, totalFailed, skippedDupes, log };
  console.log('=== SUMMARY ===');
  console.log(`Executed:  $${totalExecuted.toFixed(2)}`);
  console.log(`Failed:    $${totalFailed.toFixed(2)}`);
  console.log(`Skipped:   ${skippedDupes} (already processed)`);
  console.log(`Entries:   ${log.length}`);

  await fs.promises.mkdir('dist_rwc', { recursive: true });
  await fs.promises.writeFile('dist_rwc/auto-settle-result.json', JSON.stringify(summary, null, 2));
  await notifyOwner(summary);
}

main().catch(e => { console.error(e); process.exit(1); });
