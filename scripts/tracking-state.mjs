import 'dotenv/config';
import { Client } from 'pg';
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
await c.connect();
const q = async (sql, p=[]) => (await c.query(sql, p)).rows;
const num=(n)=>Number(n??0).toFixed(0);

console.log('=== SHIPMENTS / TRACKING STATE (live) ===');
try {
  const tot = await q(`SELECT COUNT(*) n FROM "Shipment"`);
  const withTrack = await q(`SELECT COUNT(*) n FROM "Shipment" WHERE "trackingNumber" IS NOT NULL AND "trackingNumber"<>''`);
  const verified = await q(`SELECT COUNT(*) n FROM "Shipment" WHERE "trackingVerified"=true`);
  const delivered = await q(`SELECT COUNT(*) n FROM "Shipment" WHERE status='delivered'`);
  const byCarrier = await q(`SELECT carrier, COUNT(*) n, COUNT("trackingNumber") FILTER(WHERE "trackingNumber" IS NOT NULL AND "trackingNumber"<>'') withtrk FROM "Shipment" GROUP BY carrier ORDER BY n DESC`);
  console.log(`Total shipments: ${tot[0].n}`);
  console.log(`With a tracking number: ${withTrack[0].n}`);
  console.log(`trackingVerified=true: ${verified[0].n}`);
  console.log(`status=delivered: ${delivered[0].n}`);
  console.log('By carrier:');
  for (const r of byCarrier) console.log(`  ${r.carrier||'(none)'}: ${r.n} shipments, ${r.withtrk} with tracking#`);
} catch(e){ console.log('Shipment ERR', e.message.split('\n')[0]); }

console.log('\n=== TRACKING API CONNECTORS (live) ===');
try {
  const integ = await q(`SELECT name, kind, status, "baseUrl" FROM "SwarmIntegration" WHERE name ILIKE '%track%' OR name ILIKE '%ship24%' OR name ILIKE '%9tracking%' OR name ILIKE '%carrier%'`);
  for (const r of integ) console.log(`  ${r.name}: ${r.status} (${r.baseUrl||''})`);
  if(!integ.length) console.log('  (no tracking connectors registered)');
} catch(e){ console.log('SwarmIntegration ERR', e.message.split('\n')[0]); }

console.log('\n=== TRACKING API KEYS in env (masked) ===');
const keys = process.env;
for (const k of Object.keys(keys)) {
  if (/TRACK|SHIP24|9Track|CARRIER|COURIER/i.test(k)) {
    const v = keys[k];
    console.log(`  ${k}=${v ? v.slice(0,3)+'***('+v.length+')':'(empty)'}`);
  }
}
await c.end();
