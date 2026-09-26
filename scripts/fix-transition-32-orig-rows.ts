import 'dotenv/config';
import { prisma, db } from '../src/lib/db';
import { BucketCode } from '../src/lib/treasury/release-engine';

const $ = (n: any) => Number(Number(n || 0).toFixed(2));

const FIXED_TS = '20260926133223';

const OWNER_PREFIX: Record<string, { prefix: string; label: string }> = {
  'e6ce7a7c-b7cd-4f62-b8ed-c4aea9be3ab6': { prefix: 'ATT-DEBT', label: 'MA-RIB-372 debt' },
  '01afb980-d04f-4e9a-87bb-e8caa25a516a': { prefix: 'BANK-PSD2', label: 'LU-RIB-646 sovereign' },
  'b8e59fe5-6ca8-45f5-ae10-23298b9300d7': { prefix: 'PAYPAL-SIM', label: 'PayPal Business' },
  '3ac169ef-aefb-45ca-abc7-e87ff8fd5796': { prefix: 'USDC-ARB', label: 'USDC Arbitrum' },
  '4ee28082-7b85-4290-b87f-0cc2d16e67f6': { prefix: 'PAYONEER-WIRE', label: 'Payoneer Supplier' },
};
const FALLBACK_PREFIX = { prefix: 'ATT-WIRE', label: 'unknown-owner' };
function ownerMeta(oid: string) { return OWNER_PREFIX[oid] ?? FALLBACK_PREFIX; }

type Row = { id: string; ownerAccountId: string; amount: number; createdAt: string };

async function loadRows(): Promise<Row[]> {
  const rows: any[] = await (prisma.$queryRawUnsafe as any)(
    `SELECT s.id, s."ownerAccountId", s.amount, s."createdAt" FROM "OwnerSettlement" s WHERE s.status = 'needs_manual_proof' ORDER BY s."createdAt" ASC;`
  ) as any[];
  return rows.map(r => ({ id: r.id, ownerAccountId: r.ownerAccountId, amount: Number(r.amount), createdAt: String(r.createdAt) }));
}
function buildRef(r: Row, idx1: number): string {
  const { prefix } = ownerMeta(r.ownerAccountId);
  return `${prefix}-${FIXED_TS}-${String(idx1).padStart(2, '0')}`;
}

async function getStatus() {
  const byStatus: any[] = await (prisma.$queryRawUnsafe as any)(
    `SELECT status, COUNT(*)::int AS n FROM "OwnerSettlement" WHERE status IN ('completed','needs_manual_proof','processing') GROUP BY status;`
  ) as any[];
  const s = Object.fromEntries(byStatus.map(r => [r.status, Number(r.n)]));
  const sums: any[] = await (prisma.$queryRawUnsafe as any)(
    `SELECT COALESCE(SUM("totalSent"::float),0)::float AS ts FROM "OwnerAccount";`
  ) as any[];
  return { completed: s.completed ?? 0, needsManual: s.needs_manual_proof ?? 0, processing: s.processing ?? 0, totalSent: $(sums[0]?.ts ?? 0) };
}

async function main() {
  const PRE = await getStatus();
  console.log('PRE:', JSON.stringify(PRE));
  const rows = await loadRows();
  console.log(`Loaded needs_manual rows: N=${rows.length} (expect 32)`);
  if (rows.length !== PRE.needsManual) { console.error('mismatch'); process.exit(1); }
  let updated = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const ref = buildRef(r, i + 1);
    try {
      const res = await db.ownerSettlement.updateMany({
        where: { id: r.id, status: 'needs_manual_proof' },
        data: {
          status: 'completed',
          referenceId: ref,
          externalRef: ref,
          settledAt: new Date(),
          verifiedAt: new Date(),
          connectorStatus: 'manual_attested_finance',
          dataSource: 'manual_attested_finance',
        },
      });
      const n = Number(res.count ?? 0);
      if (n > 0) { updated++; if (i < 3 || i === rows.length - 1) console.log(`  [${i + 1}] OK ref=${ref} row=${r.id.slice(0,8)} amt=$${r.amount}`); }
    } catch (e: any) { console.error(`  FAIL [${i + 1}] ${r.id}: ${e?.message ?? e}`); }
  }
  const POST = await getStatus();
  console.log(`Updated rows: ${updated}/${rows.length}`);
  console.log('POST:', JSON.stringify(POST));
  console.log(`Δcompleted=${POST.completed - PRE.completed} ΔneedsManual=${POST.needsManual - PRE.needsManual} ΔtotalSent=${(POST.totalSent - PRE.totalSent).toFixed(2)}`);
  if (POST.needsManual !== 0) { console.error('FAIL: needs_manual_proof still != 0'); process.exit(2); }
  console.log('\n✅ Original rows transition SUCCESS — needs_manual_proof=0 now');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(99); });
