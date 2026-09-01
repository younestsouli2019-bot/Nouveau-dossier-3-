import 'dotenv/config';
import { Client } from 'pg';
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, p=[]) => (await c.query(sql,p)).rows;

console.log('### SUPPLIERS — undelivered items grouped by supplier, with what is missing');
const bySup = await q(`SELECT "supplierName", status, COUNT(*)::int n, COALESCE(SUM(quantity),0)::int qty
  FROM "ProcurementItem" WHERE status NOT IN ('delivered','received')
  GROUP BY "supplierName", status ORDER BY "supplierName", n DESC`);
let cur = null;
for (const r of bySup) {
  if (r.supplierName !== cur) { console.log('\n[' + r.supplierName + ']'); cur = r.supplierName; }
  console.log('   ' + r.status + '=' + r.n + ' (qty ' + r.qty + ')');
}

console.log('\n\n### AGENT / TASK inventory — who is responsible');
const taskTbls = await q(`SELECT table_name FROM information_schema.tables WHERE table_name ILIKE '%task%' OR table_name ILIKE '%agent%'`);
console.log('candidate tables:', taskTbls.map(r=>r.table_name).join(', '));
await c.end();
