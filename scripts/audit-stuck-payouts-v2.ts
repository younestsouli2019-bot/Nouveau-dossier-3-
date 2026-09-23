import 'dotenv/config';
import { db } from '../src/lib/db';

async function main() {
  console.log('============= STUCK PAYOUT AUDIT (Neon pooler) ============\n');

  const items = await db.payoutItem.findMany({});
  console.log(`PayoutItem total N=${items.length} rows.`);

  // Group by batchNumber + status
  const groups = new Map<string, any>();
  for (const it of items) {
    const key = `${it.batchNumber || '??'}__${it.status || 'unknown'}`;
    if (!groups.has(key)) groups.set(key, { batchNumber: it.batchNumber, status: it.status, n:0, total:0, refNull:0, refOk:0, processed:0, delivered:0, fail:0, firstFail: null });
    const g = groups.get(key)!;
    g.n++; g.total += Number(it.amount||0);
    const ref = (it.externalRef || '').trim();
    if (!ref) g.refNull++;
    else {
      const placeholder = /PLACEHOLDER|TBD|REPLACE|DEMO_/i.test(ref) || ref.length < 6;
      if (!placeholder) g.refOk++; else g.refNull++;
    }
    if (it.processedAt) g.processed++;
    if ((it as any).deliveryConfirmed) g.delivered++;
    if ((it as any).failureReason) { g.fail++; if (!g.firstFail) g.firstFail = (it as any).failureReason; }
  }
  console.log('\n  batch#       status        n  total(cur)  refNull  refOk≥6  processed  delivered  fail  1st_fail');
  console.log('  ────────────────────────────────────────────────────────────────────────────────────────────────────');
  let unreleased = 0, unreleasedAmt = 0;
  for (const g of groups.values()) {
    const pad = (x: any, n: number) => (String(x??'').length > n ? String(x??'').slice(0,n-1)+'…' : String(x??'').padEnd(n));
    console.log(`  ${pad(g.batchNumber,12)} ${pad(g.status,13)} ${String(g.n).padStart(2)} $${Number(g.total||0).toFixed(2).padStart(9)} ${String(g.refNull).padStart(7)} ${String(g.refOk).padStart(7)} ${String(g.processed).padStart(9)} ${String(g.delivered).padStart(9)} ${String(g.fail).padStart(4)}  ${(g.firstFail||'').slice(0,40)}`);
    const stuck = g.status && (String(g.status).toLowerCase().includes('manual') || String(g.status) === 'processing' || String(g.status).includes('pending') || String(g.status).includes('confirm')) && (g.n - g.refOk) > 0;
    if (stuck) { unreleased += (g.n - g.refOk); unreleasedAmt += Number(g.total) * (g.n - g.refOk) / Math.max(1,g.n); }
  }
  console.log(`\n  ➡️  Items needing real confirmRelease: ${unreleased} items, $${unreleasedAmt.toFixed(2)} USD unreleased`);
  console.log();

  // Sample 3 rows with id + status + amount + externalRef for actual release script
  console.log('Sample 5 rows (for confirmRelease IDs):\n');
  const sample = items.slice(0,5);
  for (const it of sample) {
    const email = (it as any).recipientEmail || '-';
    const ref = (it.externalRef === null || it.externalRef === undefined) ? 'NULL' : it.externalRef;
    console.log(`  id=${(it.id||'').slice(0,10)}… batch=${it.batchNumber} status=${it.status} amt=$${Number(it.amount).toFixed(2)} ref=${String(ref).slice(0,25)} destOwnerId=${((it as any).ownerAccountId || (it as any).destinationOwnerId || '').slice(0,10)}… email=${email}`);
  }
  console.log();

  process.exit(0);
}
main().catch(e => { console.error('FATAL:', e.code || '', e.message?.slice(0,300) || String(e).slice(0,300)); process.exit(1); });
