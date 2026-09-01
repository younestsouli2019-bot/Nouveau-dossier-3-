import 'dotenv/config';
import { Client } from 'pg';
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, p=[]) => (await c.query(sql,p)).rows;
const roles = await q(`SELECT agent, COUNT(*)::int n FROM "SwarmAgentContext" GROUP BY agent ORDER BY n DESC LIMIT 40`);
console.log('DB SwarmAgentContext agents:', roles.map(r=>`${r.agent}=${r.n}`).join(', '));
await c.end();
