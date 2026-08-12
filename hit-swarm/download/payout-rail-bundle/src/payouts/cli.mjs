#!/usr/bin/env node
/**
 * cli.mjs — Command-line entry for the payout rail.
 *
 * Usage:
 *   node src/payouts/cli.mjs kyc verify <recipient> --operator <you> --evidence <doc1> [--evidence <doc2>] [--rail paypal]
 *   node src/payouts/cli.mjs kyc status <recipient>
 *   node src/payouts/cli.mjs kyc list
 *   node src/payouts/cli.mjs pay <item_id> --rail paypal [--mode live]
 *   node src/payouts/cli.mjs pay-batch <batch_id> --rail paypal [--mode live] [--limit N]
 *   node src/payouts/cli.mjs audit-log tail [--n 20]
 *   node src/payouts/cli.mjs audit-log grep <item_id>
 *
 * Safety:
 *   - PAYOUT_MODE defaults to 'dry'. To actually move money, pass --mode live
 *     AND set PAYOUT_MODE=live in the environment. Both must agree.
 *   - Items are paid one at a time, each with its own audit entry.
 *   - Only Class A items are eligible. Class B/C are rejected with a reason.
 */

import fs from 'node:fs';
import path from 'node:path';
import { PaypalRail } from './paypal.mjs';
import { PayoneerRail } from './payoneer.mjs';
import { verify, status, listAll } from './kyc.mjs';
import { append, readAll, AUDIT_LOG_FILE } from './audit_log.mjs';

const REPO_ROOT = process.env.REPO_ROOT || process.cwd();
const STORE_PATH = path.join(REPO_ROOT, '.autonomous-offline-store.json');
const AUDIT_PATH = path.join(REPO_ROOT, 'data', 'security', 'receivables-audit-latest.json');

function parseArgs(argv) {
  const args = { _: [] };
  let key = null;
  for (const a of argv) {
    if (a.startsWith('--')) {
      key = a.slice(2);
      args[key] = args[key] === undefined ? true : args[key];
    } else if (key && args[key] === true) {
      args[key] = a;
      key = null;
    } else if (key && Array.isArray(args[key])) {
      args[key].push(a);
    } else if (key) {
      args[key] = [args[key], a];
    } else {
      args._.push(a);
    }
  }
  // Normalize: any --foo that's an array stays an array; --foo without value stays true.
  return args;
}

function loadStore() {
  if (!fs.existsSync(STORE_PATH)) throw new Error(`Store not found: ${STORE_PATH}`);
  return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
}

function loadAudit() {
  if (!fs.existsSync(AUDIT_PATH)) {
    throw new Error(`Receivables audit not found: ${AUDIT_PATH}\nRun: node /home/z/my-project/scripts/audit_receivables.mjs first.`);
  }
  return JSON.parse(fs.readFileSync(AUDIT_PATH, 'utf8'));
}

/** Build a per-item map enriched with audit_class from the receivables audit. */
function getItemsWithAuditClass() {
  const store = loadStore();
  const audit = loadAudit();
  const auditByItemId = new Map();
  for (const p of audit.per_item || []) auditByItemId.set(p.item_id, p);

  const items = store.entities?.PayoutItem?.records || [];
  return items.map(it => {
    const a = auditByItemId.get(it.id || it._id) || {};
    return { ...it, audit_class: a.audit_class || null, audit_reasons: a.audit_reasons || [] };
  });
}

function pickRail(name) {
  if (name === 'paypal') return new PaypalRail();
  if (name === 'payoneer') return new PayoneerRail();
  throw new Error(`Unknown rail: ${name}. Available: paypal, payoneer`);
}

async function cmdKycVerify(args) {
  const recipient = args._[1];
  if (!recipient) throw new Error('recipient required');
  const evidence = Array.isArray(args.evidence) ? args.evidence : [args.evidence].filter(Boolean);
  if (!evidence.length) throw new Error('--evidence required (at least one doc reference)');
  const rec = verify({
    recipient,
    operator: args.operator || process.env.PAYOUT_OPERATOR || 'unknown',
    evidence,
    rail: args.rail || '*',
    note: args.note,
  });
  console.log('KYC verified:');
  console.log(JSON.stringify(rec, null, 2));
}

async function cmdKycStatus(args) {
  const recipient = args._[1];
  if (!recipient) throw new Error('recipient required');
  const rec = status(recipient);
  console.log(rec ? JSON.stringify(rec, null, 2) : 'NOT VERIFIED');
}

async function cmdKycList() {
  const list = listAll();
  console.log(`KYC records: ${list.length}`);
  for (const r of list) {
    console.log(`  ${r.recipient_hash} rail=${r.rail} by=${r.verified_by} at=${r.verified_at}`);
  }
}

async function cmdPay(args) {
  const itemId = args._[1];
  if (!itemId) throw new Error('item_id required');
  const railName = args.rail || 'paypal';
  const rail = pickRail(railName);

  // Cross-check mode: --mode live AND env PAYOUT_MODE=live must agree.
  if (args.mode === 'live' && process.env.PAYOUT_MODE !== 'live') {
    throw new Error('--mode live requires PAYOUT_MODE=live in env (defence in depth)');
  }
  if (args.mode === 'live') rail.mode = 'live';

  const items = getItemsWithAuditClass();
  const item = items.find(it => (it.id || it._id) === itemId || it.item_id === itemId);
  if (!item) throw new Error(`Item not found: ${itemId}`);

  console.log(`Paying item ${itemId} via ${railName} (mode=${rail.mode})`);
  console.log(`  amount=${item.amount} ${item.currency} recipient=${item.recipient}`);
  console.log(`  audit_class=${item.audit_class} reasons=${JSON.stringify(item.audit_reasons)}`);

  const result = await rail.dispatch(item);
  console.log('Result:');
  console.log(JSON.stringify(result, null, 2));
}

async function cmdPayBatch(args) {
  const batchId = args._[1];
  if (!batchId) throw new Error('batch_id required');
  const railName = args.rail || 'paypal';
  const rail = pickRail(railName);
  if (args.mode === 'live' && process.env.PAYOUT_MODE !== 'live') {
    throw new Error('--mode live requires PAYOUT_MODE=live in env (defence in depth)');
  }
  if (args.mode === 'live') rail.mode = 'live';

  const items = getItemsWithAuditClass();
  const batchItems = items.filter(it => (it.batch_id || it.batchId) === batchId);
  if (!batchItems.length) throw new Error(`No items found for batch ${batchId}`);

  const limit = args.limit ? parseInt(args.limit, 10) : batchItems.length;
  const subset = batchItems.slice(0, limit);

  console.log(`Paying batch ${batchId} via ${railName} (mode=${rail.mode})`);
  console.log(`  ${subset.length} of ${batchItems.length} items (limit=${limit})`);

  let settled = 0, rejected = 0, failed = 0;
  for (const item of subset) {
    const r = await rail.dispatch(item);
    if (r.status === 'settled') settled++;
    else if (r.status === 'rejected') rejected++;
    else failed++;
    console.log(`  ${item.id || item._id}: ${r.status} (${r.external_ref || r.error})`);
  }
  console.log(`\nSummary: settled=${settled} rejected=${rejected} failed=${failed}`);
  console.log(`Audit log: ${AUDIT_LOG_FILE}`);
}

async function cmdAuditLog(args) {
  const sub = args._[1] || 'tail';
  const entries = readAll();
  if (sub === 'tail') {
    const n = parseInt(args.n || '20', 10);
    const tail = entries.slice(-n);
    for (const e of tail) {
      console.log(`[${e.ts}] ${e.action} ${e.rail || ''} ${e.item_id || ''} ${e.result} ${e.external_ref || ''} ${e.error || ''}`);
    }
  } else if (sub === 'grep') {
    const needle = args._[2];
    if (!needle) throw new Error('grep requires an item_id');
    for (const e of entries) {
      if (e.item_id === needle) console.log(JSON.stringify(e));
    }
  } else if (sub === 'count') {
    console.log(`Total entries: ${entries.length}`);
  } else {
    throw new Error(`Unknown audit-log subcommand: ${sub}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  switch (cmd) {
    case 'kyc': {
      const sub = args._[1];
      if (sub === 'verify') return cmdKycVerify({ ...args, _: args._.slice(1) });
      if (sub === 'status') return cmdKycStatus({ ...args, _: args._.slice(1) });
      if (sub === 'list')   return cmdKycList();
      throw new Error(`kyc <verify|status|list>`);
    }
    case 'pay':        return cmdPay(args);
    case 'pay-batch':  return cmdPayBatch(args);
    case 'audit-log':  return cmdAuditLog(args);
    default:
      console.error('Usage:');
      console.error('  cli.mjs kyc verify <recipient> --operator <you> --evidence <doc1> [--evidence <doc2>] [--rail paypal]');
      console.error('  cli.mjs kyc status <recipient>');
      console.error('  cli.mjs kyc list');
      console.error('  cli.mjs pay <item_id> --rail paypal [--mode live]');
      console.error('  cli.mjs pay-batch <batch_id> --rail paypal [--mode live] [--limit N]');
      console.error('  cli.mjs audit-log tail [--n 20]');
      console.error('  cli.mjs audit-log grep <item_id>');
      process.exit(1);
  }
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
