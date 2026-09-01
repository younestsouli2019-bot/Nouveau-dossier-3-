import 'dotenv/config';
import { Client } from 'pg';
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
await c.connect();
const q = async (sql, p=[]) => (await c.query(sql, p)).rows;

console.log('=== SCAN EVERY TEXT/JSON COLUMN FOR PHANTOM / OPS TEAM / REMOVED OWNER ===');
const tables = await q(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`);
const needles = ['ops team','phantom','removed','deleted','disband','ghost','staging','fictional','demo'];
let total=0;

for (const t of tables) {
  const tn = t.table_name;
  const cols = await q(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name=$1 AND data_type IN ('text','character varying','json','jsonb')`, [tn]);
  if (!cols.length) continue;
  let hits=[];
  for (const col of cols) {
    const cn = col.column_name;
    try {
      const res = await q(`SELECT ${cn} AS v FROM "${tn}" WHERE ${cn} IS NOT NULL AND (${needles.map((_,i)=>`CAST(${cn} AS TEXT) ILIKE $${i+1}`).join(' OR ')}) LIMIT 5`, needles.map(n=>`%${n}%`));
      for (const r of res) if (r.v && r.v.toString().length) hits.push({col: cn, sample: r.v.toString().slice(0,160)});
    } catch { /* column-specific error */ }
  }
  if (hits.length) {
    total+=hits.length;
    console.log(`\n[${tn}] ${hits.length} hit(s):`);
    for (const h of hits.slice(0,4)) console.log(`   ${h.col}: ${JSON.stringify(h.sample)}`);
  }
}
console.log(`\nTOTAL hits across tables: ${total}`);

console.log('\n=== OwnerAccount (proper casing) ===');
try {
  const accts = await q(`SELECT id, label, "accountType", "isActive", "isPrimary", purposes, "accountHolder", "accountNumberLast", "totalReceived", "totalSent" FROM "OwnerAccount"`);
  for (const a of accts) console.log(`  "${a.label}" [${a.accountType}] active=${a.isActive} primary=${a.isPrimary} purp=${(a.purposes||'').slice(0,30)} holder=${a.accountHolder||''} recv=${a.totalReceived} sent=${a.totalSent}`);
} catch(e){ console.log('  err', e.message.split('\n')[0]); }

console.log('\n=== SwarmMemoryKV / SwarmIntegration / SwarmDecision contents (any Ops Team) ===');
for (const tn of ['SwarmMemoryKV','SwarmIntegration','SwarmDecision','SwarmSuggestion','AutoPilotRun','StateCheckpoint']) {
  try {
    const rows = await q(`SELECT * FROM "${tn}" LIMIT 20`);
    console.log(`\n[${tn}] ${rows.length} rows`);
    for (const r of rows.slice(0,8)) console.log('   ', JSON.stringify(r).slice(0,180));
  } catch(e){ console.log(`  ${tn}: ${e.message.split('\n')[0]}`); }
}

await c.end();
