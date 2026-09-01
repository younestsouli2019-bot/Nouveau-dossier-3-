import 'dotenv/config';
import { db } from '../src/lib/db';
(async () => {
  const items = await db.procurementItem.findMany({
    select: { name: true, category: true, status: true, quantity: true, unitPriceEst: true, totalEst: true, currency: true, supplierName: true, orderRef: true, notes: true },
    orderBy: [{ category: 'asc' }, { status: 'asc' }],
  });
  const byCat: Record<string, typeof items> = {};
  for (const it of items) {
    const cat = it.category || 'unknown';
    (byCat[cat] = byCat[cat] || []).push(it);
  }
  const out = {};
  for (const [cat, list] of Object.entries(byCat)) {
    const st = {};
    let qty = 0, est = 0;
    for (const i of list) { st[i.status] = (st[i.status] || 0) + 1; qty += i.quantity || 1; est += i.totalEst || 0; }
    out[cat] = { total: list.length, qty, estUsd: est, byStatus: st, items: list.map(i => ({ n: i.name, st: i.status, q: i.quantity, $: i.totalEst, sup: i.supplierName || '', ref: i.orderRef || '' })) };
  }
  console.log(JSON.stringify(out, null, 1));
  await db.$disconnect();
})();
