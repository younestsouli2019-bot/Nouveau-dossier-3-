import 'dotenv/config';
import { Client } from 'pg';
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, p=[]) => (await c.query(sql,p)).rows;
const pay = await q(`SELECT "batchNumber" b, "recipientName" to_, amount, currency, status, COALESCE("externalRef",'<null>') ext, COALESCE("proofHash",'<null>') proof FROM "PayoutItem" ORDER BY "createdAt" DESC LIMIT 50`);
console.log('PAYOUTS (%d):', pay.length);
for (const r of pay) console.log(JSON.stringify(r));
await c.end();
