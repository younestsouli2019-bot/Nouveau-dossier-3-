import 'dotenv/config';
import { Client } from 'pg';
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, p = []) => (await c.query(sql, p)).rows;
const fn = await q(`SELECT prosrc FROM pg_proc WHERE proname='prevent_phantom_completed_status'`);
console.log('FUNCTION prevent_phantom_completed_status:\n' + (fn[0]?.prosrc || '(not found)'));
await c.end();
