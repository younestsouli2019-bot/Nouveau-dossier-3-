import 'dotenv/config';
import { Client } from 'pg';
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, p=[]) => (await c.query(sql,p)).rows;

// Full OwnerSettlement breakdown
const rows = await q(`SELECT id, amount, currency, status, "dataSource", "connectorStatus", COALESCE("externalRef",'<null>') ext, COALESCE("proofHash",'<null>') proof, COALESCE("createdAt"::text,'<null>') created, COALESCE(("metadata"::text),'<null>') meta FROM "OwnerSettlement" ORDER BY "createdAt"`);
let exact = 0n;
let n = 0;
const scale = BigInt(100);
console.log('### OWNER SETTLEMENTS — exact sub-transaction sum (integer-cents) ###');
for (const r of rows) {
  const v = Math.round(Number(r.amount) * 100);
  exact += BigInt(v);
  n++;
  console.log(`${(exact).toString().padStart(12)}  ${r.status.padEnd(20)} ${String(r.amount).padStart(9)}  ext=${r.ext.slice(0,28)} proof=${r.proof.slice(0,16)} created=${(r.created||'').slice(0,19)} ${(r.meta||'').slice(0,40)}`);
}
const main = exact / scale;
const frac = exact % scale;
console.log('\nEXACT integer-cents SUM =', exact.toString());
console.log('EXACT decimal SUM      =', `${main}.${frac.toString().padStart(2,'0')}`);
console.log('COUNT                  =', n);
console.log('Claimed total (13744.11)= 13744.11');
// zero-sum check vs claim in cents
console.log('Cents diff vs claim     =', (exact - 1374411n).toString(), '(0 = PERFECT MATCH)');

// How many are "micro" vs "lump"? histogram of amount
console.log('\n### Amount histogram (lump-sum vs micro-aggregate) ###');
const sums = rows.map(r => Math.round(Number(r.amount)*100));
const buckets = { under10:0, '10-99':0, '100-499':0, '500-999':0, '1000+':0 };
for (const s of sums) {
  if (s<1000) buckets.under10++;
  else if (s<10000) buckets['10-99']++;
  else if (s<50000) buckets['100-499']++;
  else if (s<100000) buckets['500-999']++;
  else buckets['1000+']++;
}
console.log(JSON.stringify(buckets));
console.log('largest single:', Math.max(...sums)/100, 'smallest single:', Math.min(...sums)/100);

await c.end();
