import 'dotenv/config';
import { Client } from 'pg';
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const accounts = await c.query(`SELECT id, label, "accountType", currency, "totalReceived", "heldBalance" FROM "OwnerAccount" WHERE "isActive" = true`);
let seeded = 0;
const rows = [];
for (const a of accounts.rows) {
  const rec = Number(a.totalReceived ?? 0);
  const held = Number(a.heldBalance ?? 0);
  const delta = Math.round((rec - held) * 100) / 100;
  if (delta > 0.0001) {
    await c.query(`UPDATE "OwnerAccount" SET "heldBalance" = "heldBalance" + $1 WHERE id = $2`, [delta, a.id]);
    seeded++;
    rows.push({ label: a.label, type: a.accountType, cur: a.currency, totalReceived: rec, seededDelta: delta });
  } else {
    rows.push({ label: a.label, type: a.accountType, cur: a.currency, totalReceived: rec, seededDelta: 0, note: 'no delta (held>=received)' });
  }
}
console.log('SEEDED ACCOUNTS:', seeded);
for (const r of rows) console.log(JSON.stringify(r));

const after = await c.query(`SELECT label, "totalReceived", "heldBalance", "spendableBalance", "totalSent" FROM "OwnerAccount" WHERE "isActive" = true ORDER BY "totalReceived" DESC`);
console.log('POST-SEED STATE:');
for (const r of after.rows) {
  console.log(JSON.stringify({ label: r.label, rec: r.totalReceived, held: Number(r.heldBalance), spend: Number(r.spendableBalance), sent: r.totalSent }));
}
await c.end();
