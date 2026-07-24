#!/usr/bin/env node
/**
 * Settle Owner via Wise Bank Wire
 * Reads pending earnings from Base44 or local store, executes bank wire via Wise API.
 *
 * Env vars (from GitHub Secrets):
 *   WISE_API_KEY, WISE_PROFILE_ID, WISE_ENVIRONMENT (live/sandbox)
 *   OWNER_BENEFICIARY_NAME, OWNER_IBAN, OWNER_SWIFT, OWNER_ROUTING_NUMBER,
 *   OWNER_ACCOUNT_NUMBER, OWNER_SORT_CODE, OWNER_BANK_CURRENCY
 *   BANK_WIRE_ENABLE, SWARM_LIVE, BANK_WIRE_PROVIDER (WISE/LIVE)
 *   OWNER_BENEFICIARY_ALLOWLIST_JSON
 */

import fs from 'node:fs';
import path from 'node:path';

const WISE_API = process.env.WISE_ENVIRONMENT === 'live'
  ? 'https://api.wise.com'
  : 'https://api.sandbox.transferwise.tech';

function normIban(v) { return String(v || '').replace(/\s+/g, '').toUpperCase().trim(); }
function normDigits(v) { return String(v || '').replace(/\D+/g, '').trim(); }

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

  // SWIFT (recommended for non-US accounts / Morocco)
  const swift = String(process.env.OWNER_SWIFT_BIC || process.env.OWNER_SWIFT || '').trim();
  const swiftAccount = normDigits(process.env.OWNER_ACCOUNT_NUMBER);
  const bankCountry = String(process.env.OWNER_BANK_COUNTRY || 'MA').toUpperCase();
  if (swift && swiftAccount) {
    return { currency: ccy, name, type: 'swift', details: { swift, accountNumber: swiftAccount, country: bankCountry, legalType: 'PRIVATE' } };
  }

  // US ABA fallback
  const abartn = normDigits(process.env.OWNER_ROUTING_NUMBER);
  const accountNumber = normDigits(process.env.OWNER_ACCOUNT_NUMBER);
  if (!abartn || !accountNumber) throw new Error('Missing OWNER_ROUTING_NUMBER/OWNER_ACCOUNT_NUMBER for USD (or set OWNER_SWIFT/OWNER_SWIFT_BIC for SWIFT)');
  const accountType = String(process.env.OWNER_ACCOUNT_TYPE || 'CHECKING').toUpperCase();
  return { currency: 'USD', name, type: 'aba', details: { abartn, accountNumber, accountType, legalType: 'PRIVATE' } };
}

async function wiseRequest(endpoint, options = {}) {
  const apiKey = process.env.WISE_API_KEY;
  if (!apiKey) throw new Error('Missing WISE_API_KEY');
  const res = await fetch(`${WISE_API}${endpoint}`, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Wise API ${res.status}: ${err}`);
  }
  return res.json();
}

async function findOrCreateRecipient(spec) {
  const accounts = await wiseRequest(`/v1/accounts?profile=${process.env.WISE_PROFILE_ID}`);
  const existing = accounts.find(a => {
    if (spec.type === 'iban') return a.details?.iban === spec.details.iban;
    if (spec.type === 'sort_code') return a.details?.sortCode === spec.details.sortCode && a.details?.accountNumber === spec.details.accountNumber;
    if (spec.type === 'aba') return a.details?.abartn === spec.details.abartn && a.details?.accountNumber === spec.details.accountNumber;
    if (spec.type === 'swift') return a.details?.swift === spec.details.swift && a.details?.accountNumber === spec.details.accountNumber;
    return false;
  });
  if (existing) return existing.id;

  const body = {
    profile: parseInt(process.env.WISE_PROFILE_ID),
    accountHolderName: spec.name,
    currency: spec.currency,
    type: 'bank_transfer',
    details: { ...spec.details },
  };
  const created = await wiseRequest('/v1/accounts', { method: 'POST', body: JSON.stringify(body) });
  return created.id;
}

async function createQuote(amount, sourceCurrency, targetCurrency) {
  return wiseRequest(`/v3/quotes`, {
    method: 'POST',
    body: JSON.stringify({
      sourceCurrency,
      targetCurrency,
      sourceAmount: amount,
      profile: parseInt(process.env.WISE_PROFILE_ID),
    }),
  });
}

async function createTransfer(quoteId, recipientId, reference) {
  return wiseRequest('/v1/transfers', {
    method: 'POST',
    body: JSON.stringify({
      targetAccount: recipientId,
      quote: quoteId,
      description: reference,
      sourceAccount: parseInt(process.env.WISE_PROFILE_ID),
    }),
  });
}

async function main() {
  console.log('=== WISE BANK WIRE SETTLEMENT ===\n');

  // Validate env
  const checks = ['WISE_API_KEY', 'WISE_PROFILE_ID', 'OWNER_BENEFICIARY_NAME', 'OWNER_ACCOUNT_NUMBER'];
  for (const k of checks) {
    if (!process.env[k]) { console.error(`Missing ${k}`); process.exit(1); }
  }

  // Read pending earnings from local store or Base44
  const storePath = process.env.BASE44_OFFLINE_STORE_PATH || '.autonomous-offline-store.json';
  let items = [];
  if (fs.existsSync(storePath)) {
    const store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    items = (store?.entities?.Earning?.records || []).filter(r => r.status === 'settled_externally_pending');
  }

  if (items.length === 0) {
    console.log('No pending earnings to settle.');
    return;
  }

  console.log(`Found ${items.length} pending earnings`);

  const maxPerWire = parseFloat(process.env.WISE_PER_TRANSACTION_LIMIT || '5000') || 5000;
  const total = items.reduce((s, r) => s + (r.amount || 0), 0);
  console.log(`Total pending: $${total.toFixed(2)}`);

  // Batch into chunks of maxPerWire
  const batches = [];
  let current = [];
  let currentSum = 0;
  for (const it of items) {
    if (currentSum + it.amount > maxPerWire && current.length > 0) {
      batches.push({ items: current, total: currentSum });
      current = [];
      currentSum = 0;
    }
    current.push(it);
    currentSum += it.amount;
  }
  if (current.length > 0) batches.push({ items: current, total: currentSum });

  console.log(`Split into ${batches.length} wire(s)\n`);

  const spec = getOwnerSpec();
  const recipientId = await findOrCreateRecipient(spec);
  console.log(`Wise recipient ID: ${recipientId}\n`);

  const results = [];
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const ref = `Owner settlement batch ${i + 1}/${batches.length} — ${new Date().toISOString().slice(0, 10)}`;
    console.log(`Wire ${i + 1}: $${batch.total.toFixed(2)} — ${ref}`);

    try {
      const sourceCcy = String(process.env.WISE_SOURCE_CURRENCY || spec.currency).toUpperCase();
      const quote = await createQuote(batch.total, sourceCcy, spec.currency);
      const transfer = await createTransfer(quote.id, recipientId, ref);
      console.log(`  Transfer ID: ${transfer.id} | Status: ${transfer.status}`);
      results.push({ batch: i + 1, amount: batch.total, transferId: transfer.id, status: transfer.status });
    } catch (e) {
      console.error(`  FAILED: ${e.message}`);
      results.push({ batch: i + 1, amount: batch.total, error: e.message });
    }
  }

  const fs2 = await import('fs/promises');
  await fs2.mkdir('settlements/wise', { recursive: true });
  const outPath = `settlements/wise/wise-settle-${Date.now()}.json`;
  await fs2.writeFile(outPath, JSON.stringify({ results, timestamp: new Date().toISOString() }, null, 2));
  console.log(`\nResults written to ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
