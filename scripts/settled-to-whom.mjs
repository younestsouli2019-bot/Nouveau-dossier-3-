import 'dotenv/config';
import { Client } from 'pg';
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
await c.connect();
const q = async (sql) => (await c.query(sql)).rows;
const num = (n) => Number(n ?? 0).toFixed(2);

console.log('=== WHERE IS 471.53K / 2068 ON LIVE DB? ===\n');

const tables = ['OwnerSettlement','RevenueEvent','PayoutItem','PayoutBatch','SettlementExecution','PaymentIntent','TransactionLog','OwnerPayment','RevenueLedgerEntry','ClearingBatch','LedgerSnapshot'];
for (const t of tables) {
  try {
    const r = await q(`SELECT COUNT(*) AS n FROM "${t}"`);
    console.log(`${t}: ${r[0].n} rows`);
  } catch { console.log(`${t}: ERR`); }
}

console.log('\n=== OwnerSettlement - real proof vs internal ===');
try {
  const rows = await q(`SELECT id, "ownerAccountId", amount, currency, status, purpose, "sourceLabel", "dataSource", "externalRef", "connectorStatus", "proofHash" FROM "OwnerSettlement" ORDER BY amount DESC LIMIT 30`);
  for (const r of rows) {
    const isReal = r.externalRef && r.externalRef.trim().length>=6 && r.dataSource !== 'internal_ledger_only';
    console.log(`  ${r.amount} ${r.currency} [${r.status}] purpose=${r.purpose} src=${(r.sourceLabel||'').slice(0,28)} ds=${r.dataSource} ${isReal?'REAL extref='+r.externalRef.trim().slice(0,20):'NO-REAL-REF'}`);
  }
  const byDs = await q(`SELECT "dataSource", COUNT(*) AS n, COALESCE(SUM(amount),0) AS s FROM "OwnerSettlement" GROUP BY "dataSource"`);
  console.log('\nOwnerSettlement by dataSource:');
  for (const r of byDs) console.log(`  ${r.dataSource}: ${r.n} rows, ${num(r.s)}`);
  const real = await q(`SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS s FROM "OwnerSettlement" WHERE "externalRef" IS NOT NULL AND "externalRef" <> '' AND COALESCE("dataSource",'') <> 'internal_ledger_only'`);
  console.log(`\nREAL-move settlements (real extRef + non-internal rail): ${real[0].n} rows, ${num(real[0].s)}`);
} catch(e){ console.log('OwnerSettlement ERR', e.message.split('\n')[0]); }

console.log('\n=== RevenueLedgerEntry (internal double-entry legs) ===');
try {
  const rle = await q(`SELECT state, COUNT(*) AS n, COALESCE(SUM(amount),0) AS s, COUNT(DISTINCT "batchId") AS batches FROM "RevenueLedgerEntry" GROUP BY state ORDER BY s DESC`);
  for (const r of rle) console.log(`  ${r.state}: ${r.n} legs, ${num(r.s)} (batches ${r.batches})`);
} catch(e){ console.log('RLE ERR', e.message.split('\n')[0]); }

console.log('\n=== Who (which owner account) holds the volume? ===');
try {
  const accts = await q(`SELECT id, label, "accountType", currency, "totalReceived" AS recv, "totalSent" AS sent, "txCount" AS tx FROM "OwnerAccount" ORDER BY "totalSent" DESC, "totalReceived" DESC LIMIT 30`);
  for (const a of accts) console.log(`  ${a.label} [${a.accountType} ${a.currency}] recv=${num(a.recv)} sent=${num(a.sent)} tx=${a.tx}`);
  const sum = await q(`SELECT COALESCE(SUM("totalSent"),0) AS s, COALESCE(SUM("totalReceived"),0) AS r FROM "OwnerAccount"`);
  console.log(`  TOTAL across all OwnerAccount: received=${num(sum[0].r)} sent=${num(sum[0].s)}`);
} catch(e){ console.log('OwnerAccount ERR', e.message.split('\n')[0]); }

await c.end();
