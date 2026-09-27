import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const db = new PrismaClient({ adapter });

async function main() {
  console.log('=== Preset Owner Payout Readiness Probe — Neon PROD ===\n');

  // 1. OwnerAccount summary
  console.log('--- OwnerAccount (6 preset + any others) ---');
  const owners = await db.ownerAccount.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      label: true,
      accountType: true,
      purposes: true,
      currency: true,
      accountNumberLast: true,
      walletAddress: true,
      totalReceived: true,
      totalSent: true,
      heldBalance: true,
      spendableBalance: true,
      txCount: true,
      createdAt: true,
    },
  });
  for (const o of owners) {
    console.log(
      `  [${(o.accountNumberLast || '?').padEnd(4)}] ${o.label.padEnd(38)} ` +
      `type=${(o.accountType || '?').padEnd(12)} curr=${o.currency} ` +
      `received=$${o.totalReceived?.toFixed(2) ?? '?'.padEnd(10)} ` +
      `sent=$${o.totalSent?.toFixed(2) ?? '?'.padEnd(10)} ` +
      `held=$${o.heldBalance?.toFixed(2) ?? '?'.padEnd(10)} ` +
      `spend=$${o.spendableBalance?.toFixed(2) ?? '?'.padEnd(10)} ` +
      `txCount=${o.txCount}`
    );
  }

  // 2. OwnerSettlement by status
  console.log('\n--- OwnerSettlement status counts ---');
  const byStatus = await db.ownerSettlement.groupBy({
    by: ['status', 'connectorStatus'],
    _count: { _all: true },
    _sum: { amount: true },
  });
  for (const row of byStatus.sort((a, b) => b._count._all - a._count._all)) {
    console.log(
      `  status=${(row.status || '?').padEnd(22)} connector=${(row.connectorStatus || '?').padEnd(38)} ` +
      `count=${String(row._count._all).padEnd(6)} sum=${(row._sum.amount ?? 0).toFixed(2)}`
    );
  }

  // 3. 15 newest OwnerSettlement
  console.log('\n--- 15 newest OwnerSettlement (last 15) ---');
  const recent = await db.ownerSettlement.findMany({
    orderBy: { createdAt: 'desc' },
    take: 15,
    select: {
      id: true,
      ownerAccountId: true,
      amount: true,
      currency: true,
      status: true,
      connectorStatus: true,
      referenceId: true,
      metadata: true,
      createdAt: true,
      verifiedAt: true,
      settledAt: true,
    },
  });
  for (const s of recent) {
    const own = owners.find(o => o.id === s.ownerAccountId);
    let bucket = '?';
    try {
      if (s.metadata) {
        const md = typeof s.metadata === 'string' ? JSON.parse(s.metadata) : s.metadata;
        if (md.bucketCode) bucket = md.bucketCode;
        else if (md.release?.bucketCode) bucket = md.release.bucketCode;
      }
    } catch { /* noop */ }
    console.log(
      `  [${s.createdAt.toISOString().slice(0, 19)}] ${(own?.label || '?').slice(0, 24).padEnd(24)} ` +
      `${s.currency} ${s.amount.toFixed(2).padStart(8)} bucket=${bucket.padEnd(14)} ` +
      `status=${s.status?.padEnd(14)} conn=${(s.connectorStatus || '?').slice(0, 32).padEnd(32)} ` +
      `ref=${(s.referenceId || '?').slice(0, 30)}`
    );
  }

  // 4. Pending / processing rows (what the daemon should process on this tick)
  console.log('\n--- Pending work for daemon tick ---');
  const pendingProcess = await db.ownerSettlement.count({
    where: { OR: [{ status: 'pending' }, { status: 'processing' }, { connectorStatus: { contains: 'pending' } }] },
  });
  const totalCompleted = await db.ownerSettlement.count({ where: { status: 'completed' } });
  const sumCompleted = await db.ownerSettlement.aggregate({
    where: { status: 'completed' },
    _sum: { amount: true },
  });
  console.log(`  pending/processing settlements: ${pendingProcess}`);
  console.log(`  historical completed settlements: ${totalCompleted}  (sum ${(sumCompleted._sum.amount ?? 0).toFixed(2)})`);

  // 5. Env readiness (names only, never values)
  console.log('\n--- Hands-free env readiness (keys present? values NEVER shown) ---');
  const envNames = [
    'OWNER_HANDS_FREE_POLICY',
    'OWNER_EXEC_UNLOCK',
    'DATABASE_URL',
    'PAYOUT_TICK_SECRET',
    'AUTO_CONFIRM_OWNER_BATCHES',
    'DAEMON_HANDS_FREE_TICK',
  ];
  for (const k of envNames) {
    const v = process.env[k];
    const state = v === undefined ? 'UNSET' : v.length < 4 ? 'TOOSHORT' : v.length >= 16 ? 'OK-LONG' : 'OK';
    console.log(`  ${k.padEnd(35)} len=${String(v?.length || 0).padEnd(3)} → ${state}`);
  }

  await db.$disconnect();
  pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
