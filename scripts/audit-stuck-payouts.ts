import 'dotenv/config';
import { prisma, db } from '../src/lib/db';

async function main() {
  console.log('============= STUCK PAYOUT AUDIT (before release) ============\n');

  // OwnerExec presence check (fail-closed: must be ≥16 chars, NEVER log value)
  const u = process.env.OWNER_EXEC_UNLOCK || '';
  const tick = process.env.PAYOUT_TICK_SECRET || '';
  const ops = process.env.OPS_API_SECRET || '';
  console.log('[secrets] OWNER_EXEC_UNLOCK len=' + u.length + (u.length >= 16 ? ' ✅ meets ≥16 chars' : ' ❌ UNSET/TOO SHORT (all releases fail-closed without it)'));
  console.log('[secrets] PAYOUT_TICK_SECRET len=' + tick.length + (tick.length >= 8 ? ' ✅ ok' : ' ❌ too short'));
  console.log('[secrets] OPS_API_SECRET len=' + ops.length + (ops.length >= 8 ? ' ✅ ok' : ' ⚠️  short'));
  console.log();

  // Stuck payout items overview
  try {
    const items: any[] = await (prisma.$queryRawUnsafe as any)(`
      SELECT "batchNumber", status,
             COUNT(*)::int AS n,
             COALESCE(SUM(amount),0)::float AS total,
             MIN(currency) AS cur,
             COUNT(*) FILTER (WHERE "externalRef" IS NULL)::int AS ref_null,
             COUNT(*) FILTER (WHERE "externalRef" IS NOT NULL
                AND LENGTH(TRIM("externalRef")) >= 6
                AND "externalRef" NOT ILIKE '%PLACEHOLDER%'
                AND "externalRef" NOT ILIKE '%TBD%'
                AND "externalRef" NOT ILIKE '%REPLACE%')::int AS ref_ok,
             COUNT(*) FILTER (WHERE "processedAt" IS NOT NULL)::int AS processed_n,
             COUNT(*) FILTER (WHERE "deliveryConfirmed"=true)::int AS delivered_n,
             COUNT(*) FILTER (WHERE "failureReason" IS NOT NULL)::int AS fail_n,
             MIN("failureReason")::text AS first_fail_reason
      FROM "PayoutItem"
      GROUP BY 1,2 ORDER BY 1,2;
    `) as any[];
    console.log('PayoutItem stuck overview (23 rows grouped):');
    console.log('  batch#       status        n  total(cur)  refNull  refOk≥6  processed  delivered  fail  1st_fail');
    console.log('  ────────────────────────────────────────────────────────────────────────────────────────────────────');
    let totalUnreleased = 0, totalUnreleasedAmt = 0;
    for (const r of items) {
      const pad = (x: any, n: number) => (String(x??'').length > n ? String(x??'').slice(0,n-1)+'…' : String(x??'').padEnd(n));
      console.log(`  ${pad(r.batchNumber,12)} ${pad(r.status,13)} ${String(r.n).padStart(2)} $${Number(r.total||0).toFixed(2).padStart(9)} ${String(r.ref_null).padStart(7)} ${String(r.ref_ok).padStart(7)} ${String(r.processed_n).padStart(9)} ${String(r.delivered_n).padStart(9)} ${String(r.fail_n).padStart(4)}  ${(r.first_fail_reason||'').slice(0,40)}`);
      if (String(r.status).toLowerCase().includes('manual') || String(r.status).includes('pending') || String(r.status) === 'processing') {
        totalUnreleased += Number(r.ref_ok < r.n ? (r.n - r.ref_ok) : 0);
        totalUnreleasedAmt += Number(r.total||0) * (r.ref_ok < r.n ? (r.n - r.ref_ok) / Math.max(1,r.n) : 0);
      }
    }
    console.log(`\n  ➡️  Items requiring real confirmRelease (no len≥6 non-placeholder externalRef yet): ~${Math.round(totalUnreleased)} items (~$${totalUnreleasedAmt.toFixed(2)} USD unreleased)`);
    console.log();

    // Sample rows of each stuck batch (first 2 rows) to get IDs we need for confirmRelease
    const rows: any[] = await (prisma.$queryRawUnsafe as any)(`
      SELECT id, "batchNumber", status, amount, currency,
             "recipientEmail", "recipientName", "paymentMethod", "externalRef",
             "failureReason", "failureCode", "ownerAccountId", "processedAt",
             "destinationOwnerId"
      FROM "PayoutItem" ORDER BY "batchNumber", "createdAt" LIMIT 5;
    `) as any[];
    console.log('Sample 5 PayoutItem rows (to map real column names to confirmRelease signature):\n');
    for (const r of rows.slice(0,3)) {
      console.log('  id=' + String(r.id).slice(0,10) + '… batch=' + r.batchNumber + ' status=' + r.status + ' amt=$' + Number(r.amount).toFixed(2) + ' pm=' + (r.paymentMethod||'') + ' email=' + (r.recipientEmail||'-') + ' ownerAcctId=' + ((r.ownerAccountId||r.destinationOwnerId||'-')as string).slice(0,10) + '… externalRef=' + (r.externalRef === null ? 'NULL ⚠️' : r.externalRef.slice(0,20)));
    }
    console.log();
  } catch (e: any) { console.log('ITEMS OVERVIEW FAIL:', e.code, e.message?.slice(0,300) || String(e).slice(0,300)); process.exit(1); }

  process.exit(0);
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
