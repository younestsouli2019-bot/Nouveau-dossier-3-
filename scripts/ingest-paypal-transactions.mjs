#!/usr/bin/env node
/**
 * Ingest REAL PayPal completed credit transactions into Base44 RevenueEvent.
 *
 * This covers direct-to-owner PayPal routes that are not invoice based.
 */

import https from 'node:https';
import {
  AGENT,
  base44Create,
  existingExternalIds,
  isoDate,
  must,
  parseAmount,
  writeResult,
} from './revenue-ingestion-utils.mjs';

const PAYPAL_BASE = (process.env.PAYPAL_API_BASE_URL || 'https://api-m.paypal.com').trim();
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || '';
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || '';
const LOOKBACK_DAYS = parseInt(process.env.PAYPAL_TX_LOOKBACK_DAYS || '45', 10);
const PAGE_SIZE = parseInt(process.env.PAYPAL_TX_PAGE_SIZE || '100', 10);

function startDateIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function endDateIso() {
  return new Date().toISOString();
}

function paypalRequest(method, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, PAYPAL_BASE);
    const req = https.request({
      method,
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
          if (res.statusCode >= 400) reject(new Error(`PayPal ${res.statusCode}: ${JSON.stringify(json)}`));
          else resolve(json);
        } catch (e) {
          if (res.statusCode >= 400) reject(new Error(`PayPal ${res.statusCode}: ${data}`));
          else resolve({});
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function getPayPalAccessToken() {
  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
  return new Promise((resolve, reject) => {
    const postData = 'grant_type=client_credentials';
    const req = https.request({
      method: 'POST',
      hostname: new URL(PAYPAL_BASE).hostname,
      path: '/v1/oauth2/token',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.access_token) resolve(json.access_token);
          else reject(new Error(`PayPal token error: ${data}`));
        } catch (e) {
          reject(new Error(`PayPal token parse error: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function isCreditTransaction(tx) {
  const info = tx.transaction_info || {};
  const amount = parseAmount(info.transaction_amount?.value);
  const status = String(info.transaction_status || '').toUpperCase();
  const eventCode = String(info.transaction_event_code || '').toUpperCase();
  const terminalStatuses = new Set(['S', 'SUCCESS', 'COMPLETED']);
  const excludedEventCodes = new Set([
    'T0006', 'T0400', 'T1107', 'T1110', 'T1201', 'T1202', 'T2000',
  ]);
  return amount > 0 &&
    terminalStatuses.has(status) &&
    !excludedEventCodes.has(eventCode);
}

function normalizeTransaction(tx) {
  const info = tx.transaction_info || {};
  const payer = tx.payer_info || {};
  const amount = parseAmount(info.transaction_amount?.value);
  const currency = String(info.transaction_amount?.currency_code || 'USD').toUpperCase();
  const externalId = info.transaction_id;
  return {
    externalId: `paypal:txn:${externalId}`,
    txId: externalId,
    eventCode: info.transaction_event_code || 'paypal_credit',
    status: 'completed',
    amount,
    currency,
    occurred_at: isoDate(info.transaction_initiation_date || info.transaction_updated_date),
    counterparty: payer.email_address || payer.account_id || null,
  };
}

async function main() {
  must(PAYPAL_CLIENT_ID, 'PAYPAL_CLIENT_ID');
  must(PAYPAL_CLIENT_SECRET, 'PAYPAL_CLIENT_SECRET');
  must(AGENT.key, 'BASE44_SWARM_API_KEY');

  const token = await getPayPalAccessToken();
  const query = new URLSearchParams({
    start_date: startDateIso(LOOKBACK_DAYS),
    end_date: endDateIso(),
    fields: 'all',
    page_size: String(PAGE_SIZE),
    page: '1',
  });
  const result = await paypalRequest(
    'GET',
    `/v1/reporting/transactions?${query}`,
    { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  );

  const rows = Array.isArray(result.transaction_details) ? result.transaction_details : [];
  const credits = rows.filter(isCreditTransaction).map(normalizeTransaction);
  const existingExternal = await existingExternalIds(500);

  let created = 0;
  let skipped = 0;
  const createdIds = [];

  for (const tx of credits) {
    if (!tx.txId || existingExternal.has(tx.externalId)) {
      skipped++;
      continue;
    }
    const payload = {
      name: `PayPal credit ${tx.txId}`,
      provider: 'paypal',
      event_type: tx.eventCode,
      external_id: tx.externalId,
      status: tx.status,
      amount: tx.amount,
      currency: tx.currency,
      occurred_at: tx.occurred_at,
      is_sample: false,
      payout_status: 'unbatched',
      notes: `Direct PayPal credit${tx.counterparty ? ` from ${tx.counterparty}` : ''}`,
    };
    const res = await base44Create('RevenueEvent', payload);
    created++;
    createdIds.push(res.id);
  }

  await writeResult('ingest-paypal-transactions-result.json', {
    provider: 'paypal',
    route: 'PAYPAL',
    scanned: rows.length,
    creditsFound: credits.length,
    created,
    skipped,
    createdIds,
    lookbackDays: LOOKBACK_DAYS,
    timestamp: new Date().toISOString(),
  });

  console.log(`PayPal transactions scanned: ${rows.length}`);
  console.log(`Completed credits: ${credits.length}`);
  console.log(`Created RevenueEvent: ${created}`);
  console.log(`Skipped existing: ${skipped}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

