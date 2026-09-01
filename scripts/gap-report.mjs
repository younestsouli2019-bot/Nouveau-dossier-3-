import 'dotenv/config';
import { Client } from 'pg';
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, p=[]) => (await c.query(sql,p)).rows;

console.log('### D1: PROCUREMENT_ITEMS — delivery blocker (the PO delivery requirement)');
console.log(`status counts:`, (await q(`SELECT status, COUNT(*)::int n FROM "ProcurementItem" GROUP BY status ORDER BY n DESC`)).map(r=>`${r.status}=${r.n}`).join(', '));
const items = await q(`SELECT "poLineItem" AS line, name, "supplierName", category, quantity, "quantityReceived", status,
  COALESCE("orderRef",'<null>') orderref
  FROM "ProcurementItem"
  WHERE status NOT IN ('delivered','received')
  ORDER BY "createdAt" DESC LIMIT 60`);
console.log(`\nundelivered items (${items.length}):`);
for (const r of items) console.log(' ', JSON.stringify(r));

console.log('\n### D2: SHIPMENTS — delivery proof (carrier+tracking) requirement');
const ships = await q(`SELECT "shipmentNumber", "itemName", carrier, COALESCE("trackingNumber",'<null>') tn, "trackingVerified", status,
  COALESCE("actualDelivery"::text,'<null>') del FROM "Shipment" ORDER BY "createdAt" DESC LIMIT 40`);
for (const r of ships) console.log(' ', JSON.stringify(r));

console.log('\n### D3: PAYOUTS — funds trace (all fail-closed, need externalRef/proof)');
const pay = await q(`SELECT "batchNumber" b, "recipientName" to_, amount, currency, status, COALESCE("externalRef",'<null>') ext, COALESCE("proofHash",'<null>') proof FROM "PayoutItem" ORDER BY "createdAt" DESC LIMIT 40`);
for (const r of pay) console.log(' ', JSON.stringify(r));

console.log('\n### D4: OWNER ACCOUNTS — release state');
const oa = await q(`SELECT label, "accountType", currency, "heldBalance" held, "spendableBalance" spend, "totalReceived" recv, "totalSent" sent FROM "OwnerAccount" ORDER BY COALESCE("totalReceived",0) DESC`);
for (const r of oa) console.log(' ', JSON.stringify(r));

await c.end();
