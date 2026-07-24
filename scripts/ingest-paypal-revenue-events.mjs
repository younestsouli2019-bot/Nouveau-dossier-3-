#!/usr/bin/env node
/**
 * Ingest REAL PayPal revenue into Base44 as RevenueEvent records.
 *
 * Live-only:
 * - Reads PayPal invoices from the live PayPal API
 * - Creates RevenueEvent only for invoices with status=PAID
 * - No simulation, no projections
 *
 * Required env:
 * - PAYPAL_CLIENT_ID
 * - PAYPAL_CLIENT_SECRET
 * - BASE44_SWARM_API_KEY
 *
 * Optional:
 * - PAYPAL_API_BASE_URL (default: https://api-m.paypal.com)
 * - PAYPAL_PAGE_SIZE (default: 50)
 */

import https from 'node:https';
import { mkdir, writeFile } from 'node:fs/promises';

const PAYPAL_BASE = (process.env.PAYPAL_API_BASE_URL || 'https://api-m.paypal.com').trim();
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || '';
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || '';

const AGENT = { name: 'agent-swarm', appId: '689afeabf1db9c30efe0bd7e', key: process.env.BASE44_SWARM_API_KEY || '' };
const PAGE_SIZE = parseInt(process.env.PAYPAL_PAGE_SIZE || '50', 10);

function must(v, name) {
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

function paypalRequest(method, path, body = null, headers = {}) {
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
    if (body) req.write(JSON.stringify(body));
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

async function base44List(entity, limit = 200) {
  const url = `https://${AGENT.name}-${AGENT.appId.slice(-8)}.base44.app/api/entities/${entity}?limit=${limit}&sort_by=-created_date`;
  const res = await fetch(url, { headers: { api_key: AGENT.key } });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [data];
}

async function base44Create(entity, payload) {
  const url = `https://${AGENT.name}-${AGENT.appId.slice(-8)}.base44.app/api/entities/${entity}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { api_key: AGENT.key, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Base44 create ${entity} failed ${res.status}: ${t}`);
  }
  return res.json();
}

function parseAmount(value) {
  const n = Number.parseFloat(String(value || '0'));
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

function normalizeInvoice(inv) {
  // PayPal v2 invoice list item format
  const amount = inv.payments?.paid_amount?.value ?? inv.amount?.value ?? inv.amount?.total?.value ?? inv.amount?.total ?? '0';
  const currency = inv.payments?.paid_amount?.currency_code ?? inv.amount?.currency_code ?? inv.amount?.currency ?? inv.amount?.currency_code ?? 'USD';
  const invoiceDate = inv.detail?.invoice_date || inv.invoice_date || null;
  const created = inv.create_time || inv.created_date || inv.createTime || null;
  const occurredAt = invoiceDate ? `${invoiceDate}T00:00:00.000Z` : (created || new Date().toISOString());

  return {
    id: inv.id,
    status: inv.status,
    amount: parseAmount(amount),
    currency: String(currency || 'USD').toUpperCase(),
    number: inv.detail?.invoice_number || inv.invoice_number || null,
    occurred_at: occurredAt,
  };
}

async function main() {
  must(PAYPAL_CLIENT_ID, 'PAYPAL_CLIENT_ID');
  must(PAYPAL_CLIENT_SECRET, 'PAYPAL_CLIENT_SECRET');
  must(AGENT.key, 'BASE44_SWARM_API_KEY');

  const token = await getPayPalAccessToken();
  const invoices = await paypalRequest(
    'GET',
    `/v2/invoicing/invoices?page_size=${PAGE_SIZE}`,
    null,
    { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  );

  const items = Array.isArray(invoices.items) ? invoices.items : [];
  const paid = items.filter((i) => String(i.status || '').toUpperCase() === 'PAID').map(normalizeInvoice)
    .filter((i) => i.amount > 0 && i.id);

  const existing = await base44List('RevenueEvent', 300);
  const existingExternal = new Set(
    existing
      .map((e) => e.external_id || e.provider_event_id || e.invoice_id || null)
      .filter(Boolean)
      .map(String),
  );

  let created = 0;
  let skipped = 0;
  const createdIds = [];

  for (const inv of paid) {
    const externalId = `paypal:invoice:${inv.id}`;
    if (existingExternal.has(externalId)) {
      skipped++;
      continue;
    }
    const payload = {
      name: `PayPal invoice PAID ${inv.number || inv.id}`,
      provider: 'paypal',
      event_type: 'invoice_paid',
      external_id: externalId,
      status: 'paid',
      amount: inv.amount,
      currency: inv.currency,
      occurred_at: inv.occurred_at,
      is_sample: false,
      payout_status: 'unbatched',
    };
    const res = await base44Create('RevenueEvent', payload);
    created++;
    createdIds.push(res.id);
  }

  await mkdir('dist_rwc', { recursive: true });
  await writeFile('dist_rwc/ingest-paypal-result.json', JSON.stringify({
    provider: 'paypal',
    scanned: items.length,
    paidFound: paid.length,
    created,
    skipped,
    createdIds,
    timestamp: new Date().toISOString(),
  }, null, 2));

  console.log(`PayPal invoices scanned: ${items.length}`);
  console.log(`Paid invoices: ${paid.length}`);
  console.log(`Created RevenueEvent: ${created}`);
  console.log(`Skipped existing: ${skipped}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

