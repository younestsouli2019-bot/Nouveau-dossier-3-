import 'dotenv/config';
import { Client } from 'pg';
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, p=[]) => (await c.query(sql,p)).rows;

console.log('OwnerAccount cols:', (await q(`SELECT column_name FROM information_schema.columns WHERE table_name='OwnerAccount' ORDER BY ordinal_position`)).map(r=>r.column_name).join(', '));
console.log('\nPO statuses:', (await q(`SELECT status, COUNT(*)::int AS n FROM "PurchaseOrder" GROUP BY status ORDER BY n DESC`)).map(r=>`${r.status}=${r.n}`).join(', '));
console.log('\nOwnerSettlement statuses:', (await q(`SELECT status, dataSource, COUNT(*)::int AS n, COALESCE(SUM(COALESCE(amount::numeric,0)),0) AS total FROM "OwnerSettlement" GROUP BY status, dataSource ORDER BY n DESC`)).map(r=>JSON.stringify(r)).join('\n'));
await c.end();
