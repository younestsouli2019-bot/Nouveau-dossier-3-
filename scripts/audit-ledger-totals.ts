/**
 * audit-ledger-totals — prints the routing/audit ledger totals that sit
 * BESIDE the stuck-payout audit totals (never replacing them).
 *
 * Read-only. Uses the same Prisma client as the audit script
 * (src/lib/db, Neon pooler via DATABASE_URL). Counts only on hash-chained
 * models; amounts only where the schema defines them.
 */
import 'dotenv/config';
import { db } from '../src/lib/db';

async function main() {
  const [auditCount, payoutAuditCount, routingRules, payoutAgg] = await Promise.all([
    db.auditLedger.count(),
    db.payoutAuditLog.count(),
    db.payoutRoutingRule.count(),
    db.payoutItem.aggregate({ _sum: { amount: true }, _count: { _all: true } }),
  ]);

  const total = Number(payoutAgg._sum.amount || 0);
  const rows = Number(payoutAgg._count._all || 0);

  console.log('===== ROUTING / AUDIT LEDGER TOTALS =====');
  console.log(`AuditLedger entries (hash-chained): ${auditCount}`);
  console.log(`PayoutAuditLog entries:             ${payoutAuditCount}`);
  console.log(`PayoutRoutingRule rows:             ${routingRules}`);
  console.log(`PayoutItem rows:                    ${rows}`);
  console.log(`PayoutItem total (routed):          $${total.toFixed(2)} USD`);
  console.log('==========================================');
  console.log('Note: the audit figure above is the operative one. If a letter or');
  console.log('statement disagrees with this audit, the audit wins and the letter');
  console.log('is corrected.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('FATAL:', e.code || '', e.message?.slice(0, 300) || String(e).slice(0, 300));
    process.exit(1);
  });
