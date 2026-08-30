import 'dotenv/config';
import { Client } from 'pg';
const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

// Check current prePaidBySwarm status
const before = await c.query(`SELECT "prePaidBySwarm", COUNT(*) as cnt FROM "ProcurementItem" GROUP BY "prePaidBySwarm"`);
console.log('Before:', before.rows);

// Force ALL items to prePaidBySwarm=true
const result = await c.query(`UPDATE "ProcurementItem" SET "prePaidBySwarm" = true WHERE "prePaidBySwarm" IS NOT true`);
console.log('Updated', result.rowCount, 'items to prePaidBySwarm=true');

// Verify
const after = await c.query(`SELECT "prePaidBySwarm", COUNT(*) as cnt FROM "ProcurementItem" GROUP BY "prePaidBySwarm"`);
console.log('After:', after.rows);

// Total items
const total = await c.query(`SELECT COUNT(*) as cnt FROM "ProcurementItem"`);
console.log('Total items:', total.rows[0].cnt);

await c.end();
