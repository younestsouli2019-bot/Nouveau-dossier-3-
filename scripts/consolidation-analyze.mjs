import 'dotenv/config';
import { Client } from 'pg';
import fs from 'fs';

const OFFLINE = 'C:/Users/Dell/AppData/Local/Temp/opencode/swarm-tb/db/base44-offline-store.json';
const j = JSON.parse(fs.readFileSync(OFFLINE, 'utf8'));
const e = j.entities;

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, p = []) => (await c.query(sql, p)).rows;

const out = {};

// ---- PAYOUT ITEM DEDUPE ----
const dbItems = await q(`SELECT "recipientName","recipientEmail",amount,currency,status FROM "PayoutItem"`);
const dbKey = dbItems.map(i => `${(i.recipientEmail||i.recipientName||'').toLowerCase()}|${Number(i.amount)}|${i.currency.toUpperCase()}`);

let payToInsert = [];
let payDuplicate = [];
for (const it of e.PayoutItem) {
  const rec = it.recipient || (it.recipient_name) || '';
  const key = `${String(rec).toLowerCase()}|${Number(it.amount)}|${String(it.currency).toUpperCase()}`;
  if (dbKey.includes(key)) payDuplicate.push({ itemId: it.item_id, key, amount: it.amount, status: it.status });
  else payToInsert.push({ itemId: it.item_id, batchId: it.batch_id, name: it.recipient_name, email: it.recipient, amount: it.amount, currency: it.currency, status: it.status, method: it.recipient_type });
}
out.payoutToInsert = payToInsert;
out.payoutDuplicates = payDuplicate;
out.payoutInsertCount = payToInsert.length;
out.payoutDupCount = payDuplicate.length;

// ---- REVENUE CLASSIFICATION ----
const conf = e.RevenueEvent.filter(r => (r.status||'').toLowerCase() === 'confirmed');
const proj = e.RevenueEvent.filter(r => (r.status||'').toLowerCase() !== 'confirmed');
out.revenueConfirmed = conf.map(r => ({ eventId: r.event_id, source: r.source, amount: r.amount, currency: r.currency, description: r.description, confirmation_date: r.confirmation_date }));
out.revenueConfirmedCount = conf.length;
out.revenueProjectedCount = proj.length;
out.revenueProjectedTotal = proj.reduce((s,r)=>s+Number(r.amount||0),0);

// DB existing confirmed revenue by key to dedupe
const dbRev = await q(`SELECT source, amount, currency, description FROM "RevenueEvent" WHERE status='confirmed'`);
const dbRevKey = dbRev.map(r => `${(r.source||'').toLowerCase()}|${Number(r.amount)}|${String(r.currency).toUpperCase()}`);
let revToInsert = [];
let revDup = [];
for (const r of conf) {
  const key = `${String(r.source||'').toLowerCase()}|${Number(r.amount)}|${String(r.currency||'').toUpperCase()}`;
  if (dbRevKey.includes(key)) revDup.push({ eventId: r.event_id, key, amount: r.amount });
  else revToInsert.push({ eventId: r.event_id, source: r.source, amount: r.amount, currency: r.currency, description: r.description, confirmation_date: r.confirmation_date });
}
out.revenueToInsert = revToInsert;
out.revenueDuplicates = revDup;
out.revInsertCount = revToInsert.length;
out.revDupCount = revDup.length;

console.log(JSON.stringify(out, null, 2));
await c.end();
