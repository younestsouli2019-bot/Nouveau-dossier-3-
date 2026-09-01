import 'dotenv/config';
import { Client } from 'pg';
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, p=[]) => (await c.query(sql,p)).rows;

console.log('### SwarmAgentContext');
const cols = await q(`SELECT column_name FROM information_schema.columns WHERE table_name='SwarmAgentContext' ORDER BY ordinal_position`);
console.log('cols:', cols.map(r=>r.column_name).join(', '));
try {
  const agents = await q(`SELECT DISTINCT "swarmAgentId" FROM "SwarmAgentContext" LIMIT 40`);
  console.log('distinct swarmAgentId:', agents.map(r=>r.swarmAgentId).join(', ') || '(none)');
} catch(e){ console.log('agentId col note:', e.message); }

console.log('\n### Undelivered items by recipient (owner accountability)');
const byRec = await q(`SELECT "recipientName", status, COUNT(*)::int n FROM "ProcurementItem"
  WHERE status NOT IN ('delivered','received') GROUP BY "recipientName", status ORDER BY "recipientName"`);
for (const r of byRec) console.log(' ', JSON.stringify(r));

await c.end();
