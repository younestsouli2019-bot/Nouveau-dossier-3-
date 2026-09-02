// scripts/apply-waybills.mjs
// Bulk waybill recorder for local-carrier procurement shipments.
//
// WHY: recording a bulk set of real waybills requires per-item (ProcurementItem.id,
// the DB PRIMARY KEY) + a real tracking number. This tool reads a CSV of
// (itemId, tracking[, carrier]) rows and applies each via the same fail-closed
// path the single-shot `execute-pos-local-carriers.mjs --action waybill` uses —
// but for the whole batch, and it NEVER invents a tracking number: a row with an
// empty/imitable tracking is skipped, not guessed.
//
// TRUTH-GUARD: trackingVerified is set to false here and only becomes true once a
// real carrier `delivered` event is verified (auto verify/verify-all). This tool
// only notes which waybills were recorded and which were skipped (no real number).
//
// Input CSV (header optional):   itemId,tracking,carrier
//   itemId   = ProcurementItem.id from the Neon DB (NOT the shp-local shipment id)
//   tracking = the REAL courier waybill / tracking number
//   carrier  = optional; defaults to the item's mapped local carrier
//
// Run:
//   node scripts/apply-waybills.mjs --csv data/out/waybills.csv
//   node scripts/apply-waybills.mjs --item <id> --tracking <real>      (single)
//
// To list real item ids for the batch:
//   node scripts/apply-waybills.mjs --list

import 'dotenv/config';
import { readFileSync, writeFileSync } from 'fs';
import { Client } from 'pg';

const arg = (name, dflt) =>
  process.argv.includes(`--${name}`)
    ? (process.argv[process.argv.indexOf(`--${name}`) + 1] ?? dflt)
    : dflt;

const TOKEN = /[A-Za-z0-9]{4,}/; // a "real-looking" tracking must be a non-trivial token
const CARRIER_MAP = {
  'Jumia Logistics': 'Jumia Logistics',
  Aramex: 'Aramex Morocco',
  'Aramex Morocco': 'Aramex Morocco',
  'Poste Maroc': 'Poste Maroc (Barid Al-Maghrib)',
  'Barid Al-Maghrib': 'Poste Maroc (Barid Al-Maghrib)',
  Amana: 'Amana (Contre Remboursement / COD)',
  'Amana (Contre Remboursement / COD)': 'Amana (Contre Remboursement / COD)',
};

function normCarrier(c) {
  if (!c) return '';
  return (CARRIER_MAP[c] || c).trim();
}

const csvPath = arg('csv', '');
const singleItem = arg('item', '');
const singleTracking = arg('tracking', '');

function printUsage() {
  console.log('usage: node scripts/apply-waybills.mjs --csv <file>  |  --item <id> --tracking <real>  |  --list');
  return;
}

const wantList = arg('list', '') === 'true' || process.argv.includes('--list');
const valid = wantList || (singleItem && singleTracking) || csvPath;
if (!valid) {
  printUsage();
  process.exit(1);
}

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

// --list : dump real ProcurementItem.id + recipient + name for batch assembly.
if (arg('list', '') === 'true' || process.argv.includes('--list')) {
  const { rows } = await c.query(
    `SELECT pi.id, pi."recipientName", pi.name, pi.quantity, pi.status,
            s.id AS shipmentId, s.carrier
     FROM "ProcurementItem" pi
     LEFT JOIN "Shipment" s ON s."procurementItemId" = pi.id
     ORDER BY pi."recipientName", pi.id`,
  );
  writeFileSync('data/out/item-ids-for-waybill.json', JSON.stringify(rows, null, 2));
  console.log(JSON.stringify({ ok: true, count: rows.length, wrote: 'data/out/item-ids-for-waybill.json' }, null, 2));
  await c.end();
  process.exit(0);
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const out = [];
  for (const line of lines) {
    if (/^\s*item(Id|ID)?\s*[,]?/i.test(line) && /tracking/i.test(line)) continue; // header
    const parts = line.split(',');
    const itemId = (parts[0] || '').trim();
    const tracking = (parts[1] || '').trim();
    const carrier = (parts[2] || '').trim();
    if (!itemId || !tracking) continue;
    out.push({ itemId, tracking, carrier });
  }
  return out;
}

async function applyOne(itemId, tracking, carrier) {
  if (!TOKEN.test(tracking)) {
    return { ok: false, reason: 'no_real_tracking', itemId };
  }
  const item = (await c.query(`SELECT id, name, "recipientName", status FROM "ProcurementItem" WHERE id=$1`, [itemId])).rows[0];
  if (!item) return { ok: false, reason: 'item_not_found', itemId };
  const sh = (await c.query(`SELECT id FROM "Shipment" WHERE "procurementItemId"=$1`, [itemId])).rows[0];
  if (!sh) return { ok: false, reason: 'no_shipment_for_item', itemId };
  await c.query(
    `UPDATE "Shipment" SET "trackingNumber"=$1, carrier=$2, "trackingVerified"=false, status='shipped', "updatedAt"=NOW() WHERE id=$3`,
    [tracking, normCarrier(carrier) || item.name, sh.id],
  );
  return { ok: true, itemId, shipment: sh.id, tracking, verified: false };
}

if (singleItem && singleTracking) {
  const r = await applyOne(singleItem, singleTracking, arg('carrier', ''));
  console.log(JSON.stringify(r, null, 2));
  await c.end();
  process.exit(r.ok ? 0 : 1);
}

const rows = parseCsv(readFileSync(csvPath, 'utf8'));
const recorded = [];
const skipped = [];
for (const r of rows) {
  const out = await applyOne(r.itemId, r.tracking, r.carrier);
  (out.ok ? recorded : skipped).push(out);
}

console.log(JSON.stringify({
  ok: true,
  recorded: recorded.length,
  skipped: skipped.length,
  priorStates: skipped,
  note: 'trackingVerified=false until a real carrier delivered event is verified via verify/verify-all.',
}, null, 2));

await c.end();
process.exit(recorded.length > 0 ? 0 : 1);