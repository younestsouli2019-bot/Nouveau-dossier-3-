import 'dotenv/config';
import { Client } from 'pg';
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, p=[]) => (await c.query(sql,p)).rows;

console.log('=== OwnerAccounts (label | HELD | SPENDABLE | totalReceived | totalSent) ===');
const oa = await q(`SELECT label, "accountType", currency, "heldBalance", "spendableBalance", "totalReceived", "totalSent", "spendableLastReleasedAt" FROM "OwnerAccount" ORDER BY COALESCE("totalReceived",0) DESC`);
for (const r of oa) console.log(' ', JSON.stringify(r));

console.log('\n=== OwnerSettlements by status / dataSource ===');
const os = await q(`SELECT status, "dataSource", COUNT(*)::int AS n, COALESCE(SUM(COALESCE(amount::numeric,0)),0) AS total FROM "OwnerSettlement" GROUP BY status, "dataSource" ORDER BY n DESC`);
for (const r of os) console.log(' ', JSON.stringify(r));

console.log('\n=== OwnerSettlements awaiting completion (status not completed) ===');
const pend = await q(`SELECT id AS sid, status, "dataSource", amount, COALESCE("externalRef",'<null>') ext, COALESCE("proofHash",'<null>') proof FROM "OwnerSettlement" WHERE status NOT IN ('completed','settled','LIVE_SETTLED') ORDER BY "createdAt" DESC LIMIT 30`);
for (const r of pend) console.log(' ', JSON.stringify(r));

console.log('\n=== PurchaseOrders (poNumber | status | ack | total | supplier) ===');
const po = await q(`SELECT "poNumber", status, "ackStatus", "totalAmount", currency, "supplierName", COALESCE("batchRef",'<null>') batch FROM "PurchaseOrder" ORDER BY "createdAt" DESC LIMIT 25`);
for (const r of po) console.log(' ', JSON.stringify(r));

await c.end();
