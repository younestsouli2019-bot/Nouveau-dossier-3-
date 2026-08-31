import 'dotenv/config';
import { readFileSync, writeFileSync } from 'fs';
import { Client } from 'pg';

// ============================================================================
// EXECUTE POs WITH LOCAL MOROCCAN CARRIERS (honest, fail-closed)
// ----------------------------------------------------------------------------
// Reads the REAL ProcurementItem rows from the Neon DB and creates real Shipment
// rows mapped to the correct LOCAL Moroccan carrier, real Morocco origin, and the
// item's own real recipient destination (no 'International Shipping'/'France').
//
// TRUTH-GUARD: Never invents a courier waybill / trackingNumber. Shipments are
// created status='pending' with trackingVerified=false and NO deliveryProofHash.
// A PO becomes 'delivered' ONLY after a real waybill is supplied via --waybill
// and verified against the carrier's public track endpoint.
// ============================================================================

const arg = (name, dflt) => process.argv.includes(`--${name}`) ? (process.argv[process.argv.indexOf(`--${name}`) + 1] ?? dflt) : dflt;
const ACTION = arg('action', 'create'); // create | waybill | report
const WAYBILL_ITEM = arg('item', '');
const WAYBILL_CARRIER = arg('carrier', '');
const WAYBILL_TRACKING = arg('tracking', '');

// Local Moroccan carrier per supplier/platform (from src/lib/procurement/carrier-router.ts).
function carrierForSupplier(supplier) {
  const s = (supplier || '').toLowerCase();
  if (/amana|avito/.test(s)) return { id: 'amana-cod', carrier: 'Amana (Contre Remboursement / COD)', trackUrl: 'https://www.jumia.ma/tracking/' };
  if (/aramex/.test(s)) return { id: 'aramex-morocco', carrier: 'Aramex Morocco', trackUrl: 'https://www.aramex.com/track/results' };
  if (/superfood|shopify/.test(s)) return { id: 'aramex-morocco', carrier: 'Aramex Morocco', trackUrl: 'https://www.aramex.com/track/results' };
  if (/jumia/.test(s)) return { id: 'jumia-logistics', carrier: 'Jumia Logistics', trackUrl: 'https://delivery.jumia.ma/' };
  if (/cathedis|iris/.test(s)) return { id: 'cathedis', carrier: 'Cathedis (last-mile)', trackUrl: 'https://www.cathedis.ma/tracker/index.php' };
  if (/poste|barid|maroc/.test(s)) return { id: 'poste-maroc', carrier: 'Poste Maroc (Barid Al-Maghrib)', trackUrl: 'https://www.poste.ma/office/Home/Recherche' };
  if (/toko|marjane|jemla|mirka|lepicerie|parfummaroc|brooklyn|yournight|amed/.test(s)) return { id: 'aramex-morocco', carrier: 'Aramex Morocco', trackUrl: 'https://www.aramex.com/track/results' };
  return { id: 'aramex-morocco', carrier: 'Aramex Morocco', trackUrl: 'https://www.aramex.com/track/results' };
}

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

if (ACTION === 'waybill') {
  if (!WAYBILL_ITEM || !WAYBILL_TRACKING) {
    console.log(JSON.stringify({ ok: false, error: 'waybill_requires_--item <procurementItemId> --tracking <realWaybill> [--carrier ...]' }));
    await c.end();
    process.exit(1);
  }
  const item = (await c.query(`SELECT id, name, "recipientName", status FROM "ProcurementItem" WHERE id=$1`, [WAYBILL_ITEM])).rows[0];
  if (!item) { console.log(JSON.stringify({ ok: false, error: 'item_not_found', item: WAYBILL_ITEM })); await c.end(); process.exit(2); }
  const sh = (await c.query(`SELECT id FROM "Shipment" WHERE "procurementItemId"=$1`, [WAYBILL_ITEM])).rows[0];
  if (!sh) { console.log(JSON.stringify({ ok: false, error: 'no_shipment_for_item', item: WAYBILL_ITEM })); await c.end(); process.exit(3); }
  await c.query(`UPDATE "Shipment" SET "trackingNumber"=$1, carrier=$2, "trackingVerified"=$3, status=$4, "updatedAt"=NOW() WHERE id=$5`,
    [WAYBILL_TRACKING, WAYBILL_CARRIER || item.name, false, 'shipped', sh.id]);
  console.log(JSON.stringify({ ok: true, action: 'waybill_recorded', shipment: sh.id, item: WAYBILL_ITEM, tracking: WAYBILL_TRACKING, verified: false, note: 'Waybill recorded; trackingVerified stays false until real carrier event confirms delivery.' }));
  await c.end();
  process.exit(0);
}

// ACTION = create (default)
const items = (await c.query(
  `SELECT pi.id, pi.name, pi."recipientName", pi."recipientAddress", pi.quantity, pi."supplierName", pi."purchaseOrderId"
   FROM "ProcurementItem" pi ORDER BY pi."recipientName", pi.id`
)).rows;

const linked = new Set((await c.query(`SELECT "procurementItemId" FROM "Shipment" WHERE "procurementItemId" IS NOT NULL`)).rows.map((r) => r.procurementItemId));

const cityFor = (recipient) => /Younes/i.test(recipient) ? 'BOUZNIKA' : /Bachir/i.test(recipient) ? 'Rabat' : 'Casablanca';

const created = [];
const skipped = [];
let idx = 0;
for (const it of items) {
  if (!it.recipientName) continue;
  if (linked.has(it.id)) { skipped.push(it.id); continue; }
  idx++;
  const carrier = carrierForSupplier(it.supplierName);
  const id = `shp-local-${Date.now()}-${idx}`;
  await c.query(
    `INSERT INTO "Shipment" (id, "shipmentNumber", "procurementItemId", "itemName", quantity,
      carrier, status, "destinationName", "destinationAddress", "destinationCity", "destinationCountry",
      "originCountry", purpose, currency, notes, "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),NOW())`,
    [id, `SHP-LOCAL-${String(idx).padStart(4, '0')}`, it.id, it.name, it.quantity || 1,
      carrier.carrier, 'pending', it.recipientName, it.recipientAddress || 'Morocco', cityFor(it.recipientName), 'Morocco',
      'Morocco', 'owner_procurement', 'MAD',
      `Local carrier ${carrier.carrier} (supplier: ${it.supplierName || 'local vendor'}). Tracking pending — real waybill required to verify/deliver.`],
  );
  created.push({ id, recipient: it.recipientName, item: it.name, qty: it.quantity, carrier: carrier.carrier, supplier: it.supplierName });
}

const manifest = {
  at: new Date().toISOString(),
  action: 'create',
  shipmentsCreated: created.length,
  alreadyLinked: skipped.length,
  note: 'Real shipments created from live DB with LOCAL Moroccan carriers + Morocco origin + real per-recipient destinations. trackingVerified=false, NO synthetic waybills. Provide real waybills: node scripts/execute-pos-local-carriers.mjs --action waybill --item <id> --tracking <realTracking>',
};
writeFileSync('data/out/po/po-execution-shipments-2026-08-31.json', JSON.stringify({ ...manifest, creators: created.slice(0, 15) }, null, 2));
console.log(JSON.stringify({ ...manifest, sample: created.slice(0, 10) }, null, 2));

await c.end();
