import 'dotenv/config';
import { Client } from 'pg';
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });
await c.connect();
async function group(tbl, col) {
  return (await c.query(`SELECT status, COUNT(*) n, COALESCE(SUM(${col}),0) s FROM ${tbl} GROUP BY status ORDER BY s DESC`)).rows;
}
console.log('== OwnerSettlement =='); for (const r of await group('"OwnerSettlement"','amount')) console.log(' ', r.status,'| n',r.n,'| sum',Number(r.s).toFixed(2));
console.log('== PayoutBatch =='); for (const r of await group('"PayoutBatch"','"totalAmount"')) console.log(' ', r.status,'| n',r.n,'| sum',Number(r.s).toFixed(2));
console.log('== PaymentIntent =='); for (const r of await group('"PaymentIntent"','amount')) console.log(' ', r.status,'| n',r.n,'| sum',Number(r.s).toFixed(2));
console.log('== RevenueEvent =='); for (const r of await group('"RevenueEvent"','amount')) console.log(' ', r.status,'| n',r.n,'| sum',Number(r.s).toFixed(2));
const it = await c.query('SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM "PayoutItem"');
console.log('== PayoutItem total ==', it.rows[0].n, 'items,', Number(it.rows[0].s).toFixed(2));
await c.end();
