import 'dotenv/config';
import { Client } from 'pg';
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, p = []) => (await c.query(sql, p)).rows;

const trg = await q(`SELECT tgname, pg_get_triggerdef(t.oid) AS def FROM pg_trigger t WHERE tgname ILIKE '%revenue%' OR tgname ILIKE '%phantom%' OR tgname ILIKE '%complet%'`);
for (const t of trg) console.log('TRIGGER:', t.tgname, '\n', t.def, '\n');

const distinct = await q(`SELECT DISTINCT status FROM "RevenueEvent"`);
console.log('existing RevenueEvent statuses:', distinct.map(r=>r.status).join(', '));

await c.end();
