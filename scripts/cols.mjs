import 'dotenv/config';
import { Client } from 'pg';
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
for (const t of ['RevenueEvent', 'PayoutBatch', 'PayoutItem', 'OwnerSettlement']) {
  const r = await c.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position`, [t]
  );
  console.log(t + ': ' + r.rows.map(x => x.column_name).join(', '));
}
await c.end();
