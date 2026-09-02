import 'dotenv/config';
import { Client } from 'pg';
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, p = []) => (await c.query(sql, p)).rows;

const COLUMNS = `SELECT column_name FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position`;
const rows = await c.query(COLUMNS, ['PayoutItem']);
console.log('PayoutItem columns:', rows.rows.map(r => r.column_name).join(', '));

const pb = await c.query(COLUMNS, ['PayoutBatch']);
console.log('PayoutBatch columns:', pb.rows.map(r => r.column_name).join(', '));

// total dollars represented by PayoutItem
const sum = await c.query(`SELECT COALESCE(SUM(amount::numeric),0) AS total, COUNT(*)::int AS n FROM "PayoutItem"`);
console.log('PayoutItem total amount:', sum.rows[0].total, 'count:', sum.rows[0].n);

const pbSum = await c.query(`SELECT COALESCE(SUM("totalAmount"::numeric),0) AS total, COUNT(*)::int AS n FROM "PayoutBatch"`);
console.log('PayoutBatch total amount:', pbSum.rows[0].total, 'count:', pbSum.rows[0].n);

const setSum = await c.query(`SELECT COALESCE(SUM(amount::numeric),0) AS total, COUNT(*)::int AS n FROM "OwnerSettlement"`);
console.log('OwnerSettlement total amount:', setSum.rows[0].total, 'count:', setSum.rows[0].n);

await c.end();
