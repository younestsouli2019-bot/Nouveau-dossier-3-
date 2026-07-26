#!/usr/bin/env node
/**
 * BANKING CIRCLE DIRECT API: Submit wires to Attijari via Banking Circle's
 * payment API (no browser, no Puppeteer). Use this if puppeteer install
 * keeps failing on flaky networks.
 *
 * Auth: OAuth2 client_credentials (BANKING_CIRCLE_CLIENT_ID / SECRET)
 * Endpoint: https://api.bankingcircle.com/v1/payments
 *
 * Reads:
 *   - exports/settlement/instructions/wire_*.json   (one per wire)
 *   - bank-config.json                              (owner RIB/SWIFT)
 *
 * Writes:
 *   - settlement_id, status=processing on the Base44 PayoutBatch
 *
 * Run:
 *   BANKING_CIRCLE_CLIENT_ID=... BANKING_CIRCLE_CLIENT_SECRET=... \
 *     node scripts/banking-circle-direct-wire.mjs            # process all pending
 *   node scripts/banking-circle-direct-wire.mjs --dry-run    # preview
 *   node scripts/banking-circle-direct-wire.mjs --batch=X    # single
 */

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const FLOW = { name: 'agent-flow-ai', appId: '6888ac155ebf84dd9855ea98', key: process.env.BASE44_FLOW_API_KEY || '5b4be0fada884ca28142a3279e9880f6' };
const BC_API = process.env.BC_API_BASE || 'https://api.bankingcircle.com';
const INSTRUCTIONS_DIR = 'exports/settlement/instructions';

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    if (!a.startsWith('--')) continue;
    const [k, ...rest] = a.slice(2).split('=');
    out[k] = rest.join('=') || true;
  }
  return out;
}

function parseRib(rib) {
  // Moroccan RIB: bank(3) + branch(3) + account(13) + key(2) = 21
  const s = String(rib || '').replace(/\s+/g, '');
  if (s.length !== 21) return null;
  return {
    codeBanque: s.slice(0, 3),
    codeVille: s.slice(3, 6),
    numeroCompte: s.slice(6, 19),
    cleRib: s.slice(19, 21),
  };
}

async function getOAuthToken() {
  const id = process.env.BANKING_CIRCLE_CLIENT_ID;
  const secret = process.env.BANKING_CIRCLE_CLIENT_SECRET;
  if (!id || !secret) return null;
  const res = await fetch(`${BC_API}/v1/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`BC OAuth ${res.status}: ${t}`);
  }
  const j = await res.json();
  return j.access_token;
}

async function submitWire(token, instruction) {
  const d = instruction.destination || {};
  const rib = parseRib(d.rib);
  const payload = {
    type: 'OUTWARD_PAYMENT',
    debtor: instruction.source || { accountNumber: process.env.BC_DEBTOR_ACCOUNT },
    creditor: {
      accountNumber: d.rib,
      accountHolderName: d.beneficiary,
      bankCode: rib?.codeBanque,
      branchCode: rib?.codeVille,
      countryCode: d.country || 'MA',
      currency: d.currency || 'MAD',
      swiftBic: d.swift,
    },
    amount: {
      value: Number(instruction.amount?.converted_mad || 0).toFixed(2),
      currency: d.currency || 'MAD',
    },
    valueDate: new Date().toISOString().slice(0, 10),
    reference: instruction.reference,
    purpose: instruction.purpose || 'OWNER_SETTLEMENT',
  };
  const res = await fetch(`${BC_API}/v1/payments`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`BC POST /payments ${res.status}: ${t}`);
  }
  return res.json();
}

async function updateBase44Batch(rowId, patch) {
  const url = `https://${FLOW.name}-${FLOW.appId.slice(-8)}.base44.app/api/entities/PayoutBatch/${rowId}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { api_key: FLOW.key, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Base44 PUT ${rowId} ${res.status}: ${t}`);
  }
  return true;
}

async function fetchInstructions() {
  if (!existsSync(INSTRUCTIONS_DIR)) return [];
  const files = (await readdir(INSTRUCTIONS_DIR)).filter((f) => f.startsWith('wire_') && f.endsWith('.json'));
  const out = [];
  for (const f of files) {
    const raw = await readFile(path.join(INSTRUCTIONS_DIR, f), 'utf8');
    try { out.push(JSON.parse(raw)); } catch {}
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = !!args['dry-run'];
  const ts = new Date().toISOString();

  console.log('=== BANKING CIRCLE DIRECT WIRE ===');
  console.log(`Mode: ${dryRun ? 'DRY-RUN' : 'LIVE'}`);
  console.log(`Run at: ${ts}\n`);

  if (!process.env.BANKING_CIRCLE_CLIENT_ID || !process.env.BANKING_CIRCLE_CLIENT_SECRET) {
    console.error('FATAL: Set BANKING_CIRCLE_CLIENT_ID and BANKING_CIRCLE_CLIENT_SECRET');
    console.error('Or use the Puppeteer path: npm run feed:attijari:setup');
    process.exit(1);
  }

  const instructions = await fetchInstructions();
  if (instructions.length === 0) {
    console.log('No wire instructions found at', INSTRUCTIONS_DIR);
    console.log('Run: node scripts/generate-portal-instructions.mjs');
    process.exit(1);
  }

  console.log(`Found ${instructions.length} wire instructions\n`);

  // OAuth
  let token;
  try {
    token = await getOAuthToken();
    if (!token) throw new Error('No token');
    console.log('  OAuth: ok');
  } catch (e) {
    console.error('  OAuth failed:', e.message);
    process.exit(1);
  }

  const targetBatch = args.batch;
  const targets = targetBatch ? instructions.filter((i) => i.batch_id === targetBatch) : instructions;

  let ok = 0, fail = 0;
  for (const inst of targets) {
    if (dryRun) {
      console.log(`  WOULD-SUBMIT  ${inst.batch_id}  $${inst.amount?.payout_usd || 0} -> ${inst.destination?.beneficiary}`);
      ok++;
      continue;
    }
    try {
      const r = await submitWire(token, inst);
      ok++;
      console.log(`  OK  ${inst.batch_id}  settlement=${r.id || r.paymentId || '(no id)'}`);

      // Update Base44 PayoutBatch
      const meta = JSON.parse(await readFile(path.join(INSTRUCTIONS_DIR, `wire_${inst.batch_id}.json`), 'utf8'));
      const rowId = meta.source_batch_row_id;
      if (rowId) {
        try {
          await updateBase44Batch(rowId, {
            status: 'processing',
            notes: `${meta.notes || ''} | BC_DIRECT_WIRE_AT=${ts} | bc_payment_id=${r.id || r.paymentId}`.trim(),
          });
          console.log(`     Base44 batch updated to processing`);
        } catch (e) {
          console.log(`     WARN: Base44 update failed: ${e.message}`);
        }
      }

      // Mark instruction as submitted
      inst.status = 'submitted';
      inst.submitted_at = ts;
      inst.bc_payment_id = r.id || r.paymentId;
      await writeFile(path.join(INSTRUCTIONS_DIR, `wire_${inst.batch_id}.json`), JSON.stringify(inst, null, 2) + '\n');
    } catch (e) {
      fail++;
      console.log(`  FAIL  ${inst.batch_id}  ${e.message}`);
    }
  }

  await mkdir('dist_rwc', { recursive: true });
  await writeFile('dist_rwc/bc-direct-wire.json', JSON.stringify({
    run_at: ts,
    dry_run: dryRun,
    submitted: ok,
    failed: fail,
    total: targets.length,
  }, null, 2));

  console.log(`\n=== SUMMARY ===`);
  console.log(`Submitted: ${ok}`);
  console.log(`Failed: ${fail}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
