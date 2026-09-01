import 'dotenv/config';
import { Client } from 'pg';
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, p=[]) => (await c.query(sql,p)).rows;

// PurchaseOrders
const poCols = await q(`SELECT column_name FROM information_schema.columns WHERE table_name='PurchaseOrder' ORDER BY ordinal_position`);
console.log('PO columns:', poCols.map(r=>r.column_name).join(', '));

// OwnerAccounts
const oa = await q(`SELECT "name", kind, "heldBalance", "spendableBalance", "totalReceived", "totalSent", "spendableLastReleasedAt" FROM "OwnerAccount" ORDER BY "totalReceived" DESC NULLS LAST`);
console.log('\n=== OwnerAccounts (HELD / SPENDABLE / totalReceived / totalSent) ===');
for (const r of oa) console.log(' ', JSON.stringify(r));

// OwnerSettlements
const os = await q(`SELECT status, dataSource, COUNT(*)::int AS n, COALESCE(SUM(COALESCE(amount::numeric,0)),0) AS total FROM "OwnerSettlement" GROUP BY status, dataSource ORDER BY n DESC`);
console.log('\n=== OwnerSettlements by status/source ===');
for (const r of os) console.log(' ', JSON.stringify(r));

await c.end();
