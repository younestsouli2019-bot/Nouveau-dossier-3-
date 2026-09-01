import 'dotenv/config';
import { Client } from 'pg';
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, p=[]) => (await c.query(sql,p)).rows;

console.log('### PROCUREMENT_ITEM COLS');
console.log((await q(`SELECT column_name FROM information_schema.columns WHERE table_name='ProcurementItem' ORDER BY ordinal_position`)).map(r=>r.column_name).join(', '));
console.log('\n### SHIPMENT COLS');
console.log((await q(`SELECT column_name FROM information_schema.columns WHERE table_name='Shipment' ORDER BY ordinal_position`)).map(r=>r.column_name).join(', '));
console.log('\n### PURCHASEORDER COLS');
console.log((await q(`SELECT column_name FROM information_schema.columns WHERE table_name='PurchaseOrder' ORDER BY ordinal_position`)).map(r=>r.column_name).join(', '));
console.log('\n### PAYOUTITEM COLS (for funds trace)');
console.log((await q(`SELECT column_name FROM information_schema.columns WHERE table_name='PayoutItem' ORDER BY ordinal_position`)).map(r=>r.column_name).join(', '));
await c.end();
