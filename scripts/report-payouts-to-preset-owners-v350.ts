import 'dotenv/config';
import { prisma, db } from '../src/lib/db';

async function main() {
  const owners = await db.ownerAccount.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, label: true, accountNumberLast: true, currency: true, totalReceived: true, totalSent: true, heldBalance: true, spendableBalance: true, createdAt: true } });
  console.log(`\n========== Pre-set OwnerAccounts: Payouts & Settlements sent ==========\n`);
  const $ = (n: any) => '$' + Number(Number(n || 0).toFixed(2)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  console.log(`#  Owner ID (8)  label/prefix                     currency   totalSent       held        spendable`);
  console.log(`-- -------------- ---------------------------------- -------- ------------ ------------ ------------`);
  let i = 0;
  let grandSent = 0;
  const ownerMap: Record<string, any> = {};
  for (const o of owners) {
    i++; grandSent += Number(o.totalSent || 0);
    ownerMap[o.id] = o;
    console.log(`${String(i).padStart(2)} ${o.id.slice(0, 14)} ${String(o.label ?? '').padEnd(34).slice(0, 34)} ${String(o.currency ?? '').padEnd(8)} ${$(o.totalSent).padStart(12)} ${$(o.heldBalance).padStart(12)} ${$(o.spendableBalance).padStart(12)}`);
  }
  console.log(`--                                                                   ============`);
  console.log(`                                                                   TOTAL ${$(grandSent)}`);

  // Completed settlements grouped by owner
  const byOwner: any[] = await db.$queryRawUnsafe<any[]>(
    `SELECT "ownerAccountId" AS oid, COUNT(*)::int AS n, COALESCE(SUM(amount)::float,0) AS sum, string_agg(DISTINCT "connectorStatus", ', ') AS rails FROM "OwnerSettlement" WHERE status='completed' GROUP BY 1 ORDER BY 3 DESC;`
  );
  console.log(`\n========== Completed OwnerSettlements BY OWNER (count + sum + rails) ==========\n`);
  console.log(`Owner ID (8)  n_completed  total_amount_sent  connectorStatuses`);
  console.log(`-----------  -----------  -----------------  -----------------`);
  let compSum = 0;
  for (const r of byOwner) {
    compSum += Number(r.sum);
    const o = ownerMap[r.oid] ?? { label: '?' };
    console.log(`${String(r.oid).slice(0, 11).padEnd(11)}  ${String(r.n).padStart(9)}  ${$(r.sum).padStart(17)}  [${o.label?.slice(0, 22) ?? '?'}]  ${r.rails}`);
  }
  console.log(`            -----------  -----------------`);
  console.log(`            total n/grouped sum ${$(compSum)}  [matches OwnerAccount.totalSent grand total? diff = ${$(grandSent - compSum)}]`);

  // PayoutItems (if any, legacy v3.2-v3.3 driver releases)
  try {
    const pi: any[] = await db.$queryRawUnsafe<any[]>(
      `SELECT "ownerAccountId" AS oid, COUNT(*)::int AS n, COALESCE(SUM(amount)::float,0) AS s FROM "PayoutItem" WHERE status='completed' GROUP BY 1;`
    );
    console.log(`\n========== Legacy PayoutItem.completed BY OWNER (drivers v1+v2) ==========\n`);
    let s2 = 0;
    for (const p of pi) { s2 += Number(p.s); const o = ownerMap[p.oid] ?? { label: '?' }; console.log(`${String(p.oid).slice(0, 11)}  n=${String(p.n).padStart(2)}  sum=${$(p.s)}  ${o.label?.slice(0, 28)}`); }
    console.log(`legacy payout total: ${$(s2)}`);
  } catch (e: any) { console.log(`PayoutItem note: ${e?.message ?? String(e)}`); }

  // 5 pre-set owners with the 32 manual-proof rows sent breakdown
  const PRESET = [
    'e6ce7a7c-b7cd-4f62-b8ed-c4aea9be3ab6', // RIB372 debt/MA
    '01afb980-d04f-4e9a-87bb-e8caa25a516a', // RIB646 sovereign
    'b8e59fe5-6ca8-45f5-ae10-23298b9300d7', // PayPal Business
    '3ac169ef-aefb-45ca-abc7-e87ff8fd5796', // USDC Arbitrum
    '4ee28082-7b85-4290-b87f-0cc2d16e67f6', // Payoneer
  ];
  console.log(`\n========== 5 Pre-set owners targeted by v3.5.0 (32× $15,244.11) ==========\n`);
  for (const id of PRESET) {
    const o = ownerMap[id]; if (!o) { console.log(`${id.slice(0,12)} MISSING?`); continue; }
    const row = byOwner.find((r) => r.oid === id);
    console.log(`Owner: ${o.label}`);
    console.log(`  ID:                    ${id}`);
    console.log(`  accountNumberLast:     ${o.accountNumberLast ?? '—'}`);
    console.log(`  OwnerAccount.totalSent: ${$(o.totalSent)}`);
    console.log(`  OwnerSettlements comp:  n=${row?.n ?? '0'}  sum=${$(row?.sum ?? 0)}`);
    console.log(`  heldBalance:           ${$(o.heldBalance)}  spendableBalance: ${$(o.spendableBalance)}  totalReceived: ${$(o.totalReceived)}`);
    console.log('');
  }

  await db.$disconnect();
  await prisma.$disconnect().catch(() => {});
}

main().catch((e) => { console.error('UNHANDLED', e); process.exit(99); });
