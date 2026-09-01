import 'dotenv/config';
import { Client } from 'pg';
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const cols = await c.query(
  `SELECT column_name FROM information_schema.columns
   WHERE table_name = 'OwnerAccount'
     AND column_name IN ('heldBalance','spendableBalance','spendableLastReleasedAt')
   ORDER BY column_name`
);
console.log('COLUMNS PRESENT:', cols.rows.map(r => r.column_name).join(', ') || '(none)');

const rows = await c.query(
  `SELECT id, label, "accountType", currency, "totalReceived", "totalSent", "heldBalance", "spendableBalance"
   FROM "OwnerAccount" WHERE "isActive" = true ORDER BY "totalReceived" DESC`
);
console.log('ACTIVE OWNER ACCOUNTS:', rows.rowCount);
for (const r of rows.rows) {
  console.log(JSON.stringify({
    label: r.label, type: r.accountType, cur: r.currency,
    rec: r.totalReceived, sent: r.totalSent,
    held: Number(r.heldBalance), spend: Number(r.spendableBalance),
  }));
}

const heldSum = rows.rows.reduce((s, r) => s + Number(r.heldBalance), 0);
const spendSum = rows.rows.reduce((s, r) => s + Number(r.spendableBalance), 0);
console.log('TOTAL HELD:', heldSum, 'TOTAL SPENDABLE:', spendSum);

await c.end();
