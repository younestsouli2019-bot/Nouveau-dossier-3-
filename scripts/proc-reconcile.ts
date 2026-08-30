import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e: any) {
      const msg = String((e?.message) || e || '');
      if (msg.includes('reach database server') || msg.includes('ECONNREFUSED')) { await sleep(4000); continue; }
      throw e;
    }
  }
  throw new Error('Neon unreachable after retries');
}

async function main() {
  const fabricated = await withRetry(() => prisma.procurementItem.findMany({
    where: { status: 'settled', deliveryProofHash: null },
    select: { id: true, reference: true, status: true, receiptConfirmedAt: true },
    take: 1000,
  }));
  console.log('fabricated settled (no proof):', fabricated.length);

  let demoted = 0;
  for (const f of fabricated) {
    await withRetry(() => prisma.procurementItem.update({
      where: { id: f.id },
      data: { status: 'ordered', receiptConfirmedAt: null },
    }));
    demoted++;
  }
  console.log('demoted to ordered:', demoted);

  const after = await withRetry(() => prisma.procurementItem.groupBy({ by: ['status'], _count: { _all: true } }));
  console.log('=== procurementItem status after reconcile ===');
  after.forEach(r => console.log(r.status, r._count._all));
}

main().catch(e => { console.log('\nERR', String((e?.message && e.stack) || e).slice(0, 3000)); process.exit(1); });