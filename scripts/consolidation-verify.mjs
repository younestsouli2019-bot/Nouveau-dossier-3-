import 'dotenv/config';
import { Client } from 'pg';
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, p = []) => (await c.query(sql, p)).rows;

const pb = await q(`SELECT "batchNumber", status, "totalAmount", "itemCount" FROM "PayoutBatch" ORDER BY "createdAt"`);
console.log('PayoutBatch now:', pb.length);
for (const r of pb) console.log(' ', JSON.stringify({ batch: r.batchNumber, status: r.status, amount: Number(r.totalAmount), items: r.itemCount }));

const pi = await q(`SELECT status, COUNT(*)::int AS n FROM "PayoutItem" GROUP BY status ORDER BY n DESC`);
console.log('PayoutItem by status:', pi.map(r => `${r.status}=${r.n}`).join(', '));
const piConsol = await q(`SELECT COUNT(*)::int AS n, COALESCE(SUM(amount::numeric),0) AS total FROM "PayoutItem" WHERE "batchNumber"='PB-CONSOL-OFFLINE-001'`);
console.log('Consolidated batch items:', piConsol[0].n, 'total', piConsol[0].total);

const piExtern = await q(`SELECT COUNT(*)::int AS n FROM "PayoutItem" WHERE "externalRef" IS NOT NULL AND "externalRef"<>''`);
console.log('PayoutItems with real externalRef:', piExtern[0].n, '(must be 0 — all fail-closed)');

const rev = await q(`SELECT status, COUNT(*)::int AS n FROM "RevenueEvent" GROUP BY status ORDER BY n DESC`);
console.log('RevenueEvent by status:', rev.map(r => `${r.status}=${r.n}`).join(', '));
const revTotal = await q(`SELECT COALESCE(SUM(amount::numeric),0) AS total FROM "RevenueEvent"`);
console.log('RevenueEvent total:', revTotal[0].total);

const audit = await q(`SELECT action, COUNT(*)::int AS n FROM "AuditLedger" WHERE "entityType"='revenue_projected_quarantine' GROUP BY action`);
console.log('Quarantine audit:', audit.map(r => `${r.action}=${r.n}`).join(', '));

await c.end();
