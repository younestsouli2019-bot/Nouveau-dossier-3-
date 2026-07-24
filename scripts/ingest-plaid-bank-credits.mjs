#!/usr/bin/env node
/**
 * Ingest REAL Plaid credit transactions into Base44 RevenueEvent.
 *
 * Covers owner routes that settle through linked bank accounts.
 */

import {
  AGENT,
  base44Create,
  existingExternalIds,
  isoDate,
  must,
  parseAmount,
  writeResult,
} from './revenue-ingestion-utils.mjs';

const PLAID_CLIENT_ID = process.env.PLAID_CLIENT_ID || '';
const PLAID_SECRET = process.env.PLAID_SECRET || '';
const PLAID_ACCESS_TOKEN = process.env.PLAID_ACCESS_TOKEN || '';
const PLAID_ENV = process.env.PLAID_ENV || 'production';
const LOOKBACK_DAYS = parseInt(process.env.PLAID_INGEST_LOOKBACK_DAYS || '45', 10);

const PLAID_BASE = PLAID_ENV === 'sandbox'
  ? 'https://sandbox.plaid.com'
  : PLAID_ENV === 'development'
    ? 'https://development.plaid.com'
    : 'https://production.plaid.com';

function startDate(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function endDate() {
  return new Date().toISOString().slice(0, 10);
}

async function plaidReq(path, body) {
  const res = await fetch(`${PLAID_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: PLAID_CLIENT_ID,
      secret: PLAID_SECRET,
      access_token: PLAID_ACCESS_TOKEN,
      ...body,
    }),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`Plaid ${res.status}: ${text}`);
  return json;
}

function isCredit(tx) {
  const amount = parseAmount(tx.amount);
  // Plaid credits are negative in many transaction feeds; accept both sign conventions.
  const personal = String(tx.personal_finance_category?.primary || '').toUpperCase();
  return amount !== 0 && (
    amount < 0 ||
    personal === 'INCOME' ||
    personal === 'TRANSFER_IN'
  );
}

function normalize(tx) {
  const amount = Math.abs(parseAmount(tx.amount));
  return {
    externalId: `plaid:txn:${tx.transaction_id}`,
    amount,
    currency: String(tx.iso_currency_code || 'USD').toUpperCase(),
    occurred_at: isoDate(tx.authorized_date || tx.date),
    name: tx.name || tx.merchant_name || tx.transaction_id,
  };
}

async function main() {
  must(PLAID_CLIENT_ID, 'PLAID_CLIENT_ID');
  must(PLAID_SECRET, 'PLAID_SECRET');
  must(PLAID_ACCESS_TOKEN, 'PLAID_ACCESS_TOKEN');
  must(AGENT.key, 'BASE44_SWARM_API_KEY');

  const result = await plaidReq('/transactions/get', {
    start_date: startDate(LOOKBACK_DAYS),
    end_date: endDate(),
    options: { count: 500, offset: 0 },
  });

  const txs = Array.isArray(result.transactions) ? result.transactions : [];
  const credits = txs.filter(isCredit).map(normalize).filter((t) => t.amount > 0);
  const existingExternal = await existingExternalIds(600);

  let created = 0;
  let skipped = 0;
  const createdIds = [];

  for (const tx of credits) {
    if (!tx.externalId || existingExternal.has(tx.externalId)) {
      skipped++;
      continue;
    }
    const payload = {
      name: `Plaid credit ${tx.name}`,
      provider: 'plaid',
      event_type: 'bank_credit',
      external_id: tx.externalId,
      status: 'settled',
      amount: tx.amount,
      currency: tx.currency,
      occurred_at: tx.occurred_at,
      is_sample: false,
      payout_status: 'unbatched',
      notes: 'Plaid bank credit',
    };
    const res = await base44Create('RevenueEvent', payload);
    created++;
    createdIds.push(res.id);
  }

  await writeResult('ingest-plaid-credits-result.json', {
    provider: 'plaid',
    route: 'PLAID',
    scanned: txs.length,
    creditsFound: credits.length,
    created,
    skipped,
    createdIds,
    lookbackDays: LOOKBACK_DAYS,
    timestamp: new Date().toISOString(),
  });

  console.log(`Plaid transactions scanned: ${txs.length}`);
  console.log(`Plaid credits found: ${credits.length}`);
  console.log(`Created RevenueEvent: ${created}`);
  console.log(`Skipped existing: ${skipped}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

