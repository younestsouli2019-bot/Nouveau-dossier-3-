import 'dotenv/config';
import { Client } from 'pg';
const c = new Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const r = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'ProcurementItem' ORDER BY ordinal_position");
console.log('ProcurementItem columns:', r.rows.map(x => x.column_name).join(', '));
const s = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'Shipment' ORDER BY ordinal_position");
console.log('Shipment columns:', s.rows.map(x => x.column_name).join(', '));
await c.end();
