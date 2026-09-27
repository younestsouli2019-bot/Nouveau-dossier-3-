import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const db = new PrismaClient({ adapter });

async function main() {
  console.log('=== ProcurementItem Status Counts (Global Neon PROD) ===\n');
  
  const byStatus = await db.procurementItem.groupBy({
    by: ['status'],
    _count: { _all: true },
  });
  console.log('By status:');
  for (const row of byStatus.sort((a, b) => b._count._all - a._count._all)) {
    console.log(`  ${row.status.padEnd(20)} ${row._count._all}`);
  }
  
  console.log('\n=== Items NOT in pending/cancelled (3-way-match scope) ===');
  const totalScoped = await db.procurementItem.count({
    where: { status: { notIn: ['pending', 'cancelled'] } },
  });
  console.log(`  Total scoped items: ${totalScoped}`);
  
  const noReceipt = await db.procurementItem.count({
    where: {
      status: { notIn: ['pending', 'cancelled'] },
      OR: [
        { receiptConfirmedAt: null },
        { quantityReceived: null },
        { quantityReceived: 0 },
      ],
    },
  });
  console.log(`  Missing receipt (no confirmedAt OR qty 0/null): ${noReceipt}`);
  
  console.log('\n=== Sample of ordered/shipped items with no receipt ===');
  const samples = await db.procurementItem.findMany({
    where: {
      status: { notIn: ['pending', 'cancelled', 'delivered', 'receipt_confirmed', 'settled'] },
      OR: [
        { receiptConfirmedAt: null },
        { quantityReceived: null },
      ],
    },
    take: 20,
    select: {
      id: true,
      reference: true,
      name: true,
      status: true,
      receiptConfirmedAt: true,
      quantityReceived: true,
      purchaseOrderId: true,
      createdAt: true,
    },
  });
  for (const s of samples) {
    console.log(`  [${s.status.padEnd(12)}] ${s.reference?.padEnd(10) || '?'} ${s.name.slice(0, 50)} qtyRcvd=${s.quantityReceived} rcvdAt=${s.receiptConfirmedAt}`);
  }
  
  console.log('\n=== RAW SQL: status, count, no-receipt count ===');
  const raw = await db.$queryRawUnsafe(`
    SELECT
      status,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE "receiptConfirmedAt" IS NULL OR "quantityReceived" IS NULL OR "quantityReceived" = 0) AS no_receipt
    FROM "ProcurementItem"
    WHERE status NOT IN ('pending', 'cancelled')
    GROUP BY status
    ORDER BY total DESC;
  `);
  for (const r of raw) {
    console.log(`  ${String(r.status).padEnd(20)} total=${String(r.total).padEnd(6)} noReceipt=${r.no_receipt}`);
  }
  
  await db.$disconnect();
  pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
