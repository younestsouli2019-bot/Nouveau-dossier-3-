#!/usr/bin/env node
/**
 * Ingest REAL Wise account credits into Base44 RevenueEvent.
 *
 * Covers owner routes that eventually settle through Wise / bank wire.
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

const WISE_API = process.env.WISE_ENVIRONMENT === 'live'
  ? 'https://api.wise.com'
  : 'https://api.sandbox.transferwise.tech';

const WISE_API_KEY = process.env.WISE_API_KEY || '';
const WISE_PROFILE_ID = process.env.WISE_PROFILE_ID || '';
const LOOKBACK_DAYS = parseInt(process.env.WISE_INGEST_LOOKBACK_DAYS || '45', 10);
const TARGET_CURRENCIES = String(process.env.WISE_INGEST_CURRENCIES || 'USD,MAD,EUR')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

function intervalStart(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function wiseReq(endpoint) {
  const res = await fetch(`${WISE_API}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${WISE_API_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Wise ${res.status}: ${t}`);
  }
  return res.json();
}

function isIncomingCredit(tx) {
  const type = String(tx.type || tx.referenceType || '').toLowerCase();
  const amount = parseAmount(tx.amount?.value ?? tx.amount?.amount ?? tx.total ?? tx.amount);
  const direction = String(tx.details?.type || tx.operationType || '').toLowerCase();
  return amount > 0 && (
    type.includes('credit') ||
    type.includes('deposit') ||
    type.includes('incoming') ||
    direction.includes('credit')
  );
}

function normalizeCredit(balanceId, currency, tx) {
  const amount = parseAmount(tx.amount?.value ?? tx.amount?.amount ?? tx.total ?? tx.amount);
  const ext = tx.referenceNumber || tx.id || tx.transferId || tx.paymentReference;
  return {
    externalId: `wise:credit:${balanceId}:${ext}`,
    name: tx.details?.reference || tx.referenceText || tx.paymentReference || `Wise credit ${ext}`,
    amount,
    currency,
    occurred_at: isoDate(tx.date || tx.createdOn || tx.createdAt || tx.bookingDate),
  };
}

async function main() {
  must(WISE_API_KEY, 'WISE_API_KEY');
  must(WISE_PROFILE_ID, 'WISE_PROFILE_ID');
  must(AGENT.key, 'BASE44_SWARM_API_KEY');

  const balances = await wiseReq(`/v4/profiles/${WISE_PROFILE_ID}/balances?types=STANDARD`);
  const balanceRows = Array.isArray(balances) ? balances : [];
  const existingExternal = await existingExternalIds(600);

  let scanned = 0;
  let creditsFound = 0;
  let created = 0;
  let skipped = 0;
  const createdIds = [];

  for (const balance of balanceRows) {
    const currency = String(balance.currency || '').toUpperCase();
    if (!TARGET_CURRENCIES.includes(currency)) continue;

    const params = new URLSearchParams({
      currency,
      intervalStart: intervalStart(LOOKBACK_DAYS),
      intervalEnd: new Date().toISOString(),
      type: 'COMPACT',
    });

    let statement;
    try {
      statement = await wiseReq(`/v1/profiles/${WISE_PROFILE_ID}/balance-statements/${balance.id}/statement.json?${params}`);
    } catch (e) {
      console.warn(`Wise statement skip for balance ${balance.id} ${currency}: ${e.message}`);
      continue;
    }

    const txs = Array.isArray(statement.transactions) ? statement.transactions : [];
    scanned += txs.length;
    const credits = txs.filter(isIncomingCredit).map((tx) => normalizeCredit(balance.id, currency, tx));
    creditsFound += credits.length;

    for (const tx of credits) {
      if (!tx.externalId || existingExternal.has(tx.externalId)) {
        skipped++;
        continue;
      }
      const payload = {
        name: tx.name,
        provider: 'wise',
        event_type: 'balance_credit',
        external_id: tx.externalId,
        status: 'settled',
        amount: tx.amount,
        currency: tx.currency,
        occurred_at: tx.occurred_at,
        is_sample: false,
        payout_status: 'unbatched',
        notes: 'Wise balance credit',
      };
      const res = await base44Create('RevenueEvent', payload);
      created++;
      createdIds.push(res.id);
    }
  }

  await writeResult('ingest-wise-credits-result.json', {
    provider: 'wise',
    route: 'BANK_WIRE/WISE',
    scanned,
    creditsFound,
    created,
    skipped,
    createdIds,
    lookbackDays: LOOKBACK_DAYS,
    timestamp: new Date().toISOString(),
  });

  console.log(`Wise rows scanned: ${scanned}`);
  console.log(`Wise credits found: ${creditsFound}`);
  console.log(`Created RevenueEvent: ${created}`);
  console.log(`Skipped existing: ${skipped}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

