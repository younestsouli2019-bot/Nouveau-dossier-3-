import 'dotenv/config';
import { Client } from 'pg';
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name='AuditLedger' ORDER BY ordinal_position`);
console.log('AuditLedger:', r.rows.map(x => x.column_name).join(', '));
await c.end();
