import { Client } from 'pg';
const c = new Client({ connectionString: 'postgresql://neondb_owner:npg_Vf2nqLByt4Hc@ep-dry-voice-aymtji8x-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require' });
await c.connect();
const r = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'ProcurementItem' ORDER BY ordinal_position");
console.log('ProcurementItem columns:', r.rows.map(x => x.column_name).join(', '));
const s = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'Shipment' ORDER BY ordinal_position");
console.log('Shipment columns:', s.rows.map(x => x.column_name).join(', '));
await c.end();
