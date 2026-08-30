import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e: any) {
      const msg = String((e?.message) || e || '');
      if (msg.includes('reach database server') || msg.includes('ECONNREFUSED')) { await sleep(3000); continue; }
      throw e;
    }
  }
  throw new Error('Neon unreachable after retries');
}

async function main() {
  const po = await withRetry(() => prisma.purchaseOrder.findMany({ take: 10, orderBy: { createdAt: 'desc' }, select: { poNumber: true, title: true, status: true, supplierName: true, totalAmount: true, createdAt: true } }));
  console.log('=== purchaseOrder ===');
  po.forEach(p => console.log(JSON.stringify({ no: p.poNumber, title: (p.title || '').slice(0, 35), st: p.status, supplier: p.supplierName, usd: p.totalAmount })));

  const items = await withRetry(() => prisma.procurementItem.groupBy({ by: ['recipientName'], _count: { _all: true } }));
  console.log('=== procurementItem by recipient ===');
  items.forEach(r => console.log(r.recipientName, r._count._all));

  const byStatus = await withRetry(() => prisma.procurementItem.groupBy({ by: ['status'], _count: { _all: true } }));
  console.log('=== procurementItem by status ===');
  byStatus.forEach(r => console.log(r.status, r._count._all));

  const withOrderRef = await withRetry(() => prisma.procurementItem.count({ where: { orderRef: { not: null } } }));
  const withProof = await withRetry(() => prisma.procurementItem.count({ where: { deliveryProofHash: { not: null } } }));
  const pending = await withRetry(() => prisma.procurementItem.count({ where: { status: 'pending' } }));
  const started = await withRetry(() => prisma.procurementItem.count({ where: { status: { notIn: ['pending', 'cancelled'] } } }));
  console.log('items: pending=', pending, ' started=', started, ' withOrderRef=', withOrderRef, ' withProof=', withProof);

  const shByStatus = await withRetry(() => prisma.shipment.groupBy({ by: ['status'], _count: { _all: true } }));
  console.log('=== shipment by status ===');
  shByStatus.forEach(r => console.log(r.status, r._count._all));
  const shWithTracking = await withRetry(() => prisma.shipment.count({ where: { trackingNumber: { not: null } } }));
  const shCarrier = await withRetry(() => prisma.shipment.count({ where: { carrier: { not: null } } }));
  console.log('shipments with carrier=', shCarrier, ' with trackingNumber=', shWithTracking);
}

main().catch(e => { console.log('\n\nFULL ERROR:\n', String((e?.message && e.stack) || e).slice(0, 2500)); process.exit(1); });