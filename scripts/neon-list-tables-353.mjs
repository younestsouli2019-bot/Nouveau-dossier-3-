import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const db = new PrismaClient({ adapter });

async function main() {
  const raw = await db.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;`
  );
  console.log('Tables in Neon PROD public schema:\n');
  for (const r of raw) console.log(`  ${r.table_name}`);
  await db.$disconnect();
  pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
