import 'dotenv/config';
import { prisma, db } from '../src/lib/db';

async function main() {
  const rows: any[] = await (prisma.$queryRawUnsafe as any)(
    `SELECT s.id, s."ownerAccountId", s.amount, s.currency, s."connectorStatus", s."dataSource",
            s."sourceLabel", s."destinationLabel", s."purpose", s.metadata, s."createdAt",
            o."accountNumberLast", o.label as "ownerLabel"
     FROM "OwnerSettlement" s LEFT JOIN "OwnerAccount" o ON o.id = s."ownerAccountId"
     WHERE s.status = 'needs_manual_proof'
     ORDER BY s."createdAt" ASC;`
  ) as any[];
  const $ = (n: any) => Number(n || 0);
  const total = rows.reduce((s, r) => s + $(r.amount), 0);
  const byOwner = new Map<string, { label: string; count: number; sum: number; rows: any[] }>();
  for (const r of rows) {
    const key = String(r.ownerAccountId);
    if (!byOwner.has(key)) byOwner.set(key, { label: `${r.ownerLabel ?? '?'} (${r.accountNumberLast ?? '?'})`, count: 0, sum: 0, rows: [] });
    const b = byOwner.get(key)!;
    b.count++;
    b.sum += $(r.amount);
    b.rows.push(r);
  }
  console.log('=== INVENTORY: needs_manual_proof OwnerSettlements ===');
  console.log(`Total rows: ${rows.length}`);
  console.log(`Total amount: $${total.toFixed(2)}`);
  console.log(`Owners count: ${byOwner.size}`);
  console.log('');
  console.log('--- By Owner ---');
  for (const [id, b] of byOwner) {
    console.log(`  ownerId=${id}  label=${b.label}  count=${b.count}  sum=$${b.sum.toFixed(2)}`);
  }
  console.log('');
  console.log('--- First 5 row IDs (sample) ---');
  for (const r of rows.slice(0, 5)) {
    const md = (typeof r.metadata === 'string') ? (() => { try { return JSON.parse(r.metadata); } catch { return {}; } })() : (r.metadata ?? {});
    console.log(`  id=${r.id}  owner=${r.ownerAccountId}  amt=$${$(r.amount).toFixed(2)}  cur=${r.currency}  purpose=${r.purpose}  bucket=${md?.bucketCode ?? md?.bucket ?? '?'}  srcLbl=${r.sourceLabel?.slice(0,40)??''}`);
  }
  console.log('');
  console.log('--- ConnectorStatus distribution ---');
  const cs = new Map<string, number>();
  for (const r of rows) cs.set(String(r.connectorStatus), (cs.get(String(r.connectorStatus)) ?? 0) + 1);
  for (const [k, v] of cs) console.log(`  ${k}: ${v}`);
  console.log('');
  console.log('--- DataSource distribution ---');
  const ds = new Map<string, number>();
  for (const r of rows) ds.set(String(r.dataSource), (ds.get(String(r.dataSource)) ?? 0) + 1);
  for (const [k, v] of ds) console.log(`  ${k}: ${v}`);
}
main().catch(e => { console.error(e); process.exit(1); });
