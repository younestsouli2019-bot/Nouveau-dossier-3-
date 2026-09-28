#!/usr/bin/env node
/* PO receipts fail-closed audit v355 — 2026-09-28
 *
 * User 2026-09-28 VERBATIM:
 *   "POS not yet delivered to Younes Tsouli OWNER in Bouznika, no confirmed receipts
 *    and I hesitate to phone Hind Bachir or Wafae to get confirmations of their POs deliveries"
 *   "Rabat Agdal Contentieux / Traitement (45 Av Ibn Sina Appt 4 OWNER Younes Tsouli CIN A337773 not Bachir)"
 *
 * FAIL-CLOSED RULE (enforced in Prisma TRUTH-001…014 guards):
 *   ProcurementItem.status in {delivered, receipt_confirmed, settled} AND
 *   receiptConfirmedAt IS NOT NULL BOTH REQUIRE an external delivery proof.
 * This script is READ-ONLY — it prints receipts MISSING + the honest NO-OP decision,
 * and ZERO DB writes / no fabricated confirmations.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '@prisma/client';

const DATABASE_URL = process.env.DATABASE_URL || '';
if (!DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(1); }

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const OWNERS = [
  { label: 'Younes Tsouli Bouznika OWNER (CIN A337773 — Contentieux Agdal 018)',
    matches: [/younes/i, /Bouznika/i, /Lot Rita/i],
    requiredDeliveriesBefore: new Date('2026-09-28T23:59:59Z') },
  { label: 'Bachir Tsouli — Agdal 45 Av Ibn Sina Appt 4 (RECIPIENT only — NOT owner)',
    matches: [/bachir/i, /Agdal/i, /Ibn Sina/i] },
  { label: 'Hind Tsouli — Casablanca Sidi Yahya Centre',
    matches: [/hind/i, /Sidi Yahya/i, /JASMIN/i, /12150/i] },
  { label: 'Wafae Rais TEMU WR Agdal (45 Av Ibn Sina)',
    matches: [/Wafae/i, /Rais/i, /WR-/i, /TEMU/i] },
];

function matchesRecipient(row, o) {
  const hay = [
    row.recipientName, row.recipientAddress, row.deliveryAddress,
    row.orderRef, row.supplierName, (row.metadata || '').toString(),
    (row.notes || '').toString(),
  ].filter(Boolean).join(' || ');
  return o.matches.some(re => re.test(hay));
}

async function main() {
  console.log('FAIL-CLOSED RECEIPT AUDIT 2026-09-28 — NO DB WRITES, ALL DECISIONS HONEST');
  console.log('RULE: ProcurementItem.status >= delivered requires REAL carrier or user proof.');
  console.log('USER EXPLICIT: "hesitate to phone Hind/Bachir/Wafae → no fabrications."\n');

  // 1) ProcurementItem rollup by Owner bucket (cols verified: settledAt DOES NOT EXIST — use deliveredAt + receiptConfirmedAt + status field, unitPriceEst not unit_price, no unit_price/currency column — use currency global field)
  const items = await prisma.$queryRawUnsafe(`
    SELECT "id","purchaseOrderId",status,"recipientName","recipientAddress",
           "deliveryAddress","orderRef","supplierName",
           "orderedAt","shippedAt","deliveredAt","receiptConfirmedAt",
           "deliveryProofHash","receiptConfirmedBy",
           COALESCE(quantity,1) AS qty,"unitPriceEst",currency
    FROM "ProcurementItem"
    ORDER BY "createdAt" DESC
    LIMIT 400;`);

  const buckets = OWNERS.map(o => ({
    owner: o.label,
    ordered: [], shipped: [], delivered: [], receipt_confirmed: [], settled: [],
    missingNoProof: [],
  }));
  let totalRows = 0;
  for (const row of items) {
    totalRows++;
    for (let i = 0; i < OWNERS.length; i++) {
      if (matchesRecipient(row, OWNERS[i])) {
        const st = (row.status || '').toString().toLowerCase();
        const b = buckets[i];
        if (st.includes('order') || st === 'pending') b.ordered.push(row);
        else if (st.includes('ship') || st.includes('transit')) b.shipped.push(row);
        else if (st.includes('delivered') || st.includes('receipt') || st.includes('settle')) {
          if (st.includes('delivered')) b.delivered.push(row);
          if (st.includes('receipt') || row.receiptConfirmedAt) b.receipt_confirmed.push(row);
          if (st.includes('settle')) b.settled.push(row);
        }
        if (!row.receiptConfirmedAt && !row.deliveryProofHash && (b.shipped.includes(row) || b.delivered.includes(row) || b.ordered.includes(row))) {
          b.missingNoProof.push(row);
        }
        break;
      }
    }
  }
  console.log(`ProcurementItem scanned = ${totalRows} rows (LIMIT 400, latest first)\n`);
  let totalMissing = 0;
  for (const b of buckets) {
    const mCount = b.missingNoProof.length;
    totalMissing += mCount;
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`✅ ${b.owner}`);
    console.log(`   ordered=${b.ordered.length} · shipped=${b.shipped.length} · delivered=${b.delivered.length} · receipt_confirmed=${b.receipt_confirmed.length} · settled=${b.settled.length}`);
    console.log(`   🔴 MISSING PROOF = ${mCount} items (no receiptConfirmedAt, no deliveryProofHash)`);
    if (b.shipped.slice(0, 3).length) {
      console.log(`   ⏳ shipped (last 3) = ` + b.shipped.slice(0, 3).map(r =>
        `${r.recipientName || '?'} ${r.orderRef || ''} ${r.supplierName || ''}`.trim().replace(/\s+/g,' ')).join(' | '));
    }
    console.log(`   ⚖️  HONEST ACTION: NO OP (fail-closed) — user has not called family recipients to get delivery SMS/Waybill; no fabricated confirmations.`);
  }
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`TOTAL receipt gaps still pending = ${totalMissing}`);

  // 2) Shipment table (v354 truth) — only SHP-LOCAL-0001 Bachir delivered, rest pending
  const sh = await prisma.$queryRawUnsafe(`
    SELECT "shipmentNumber",status,"destinationName","procurementItemId","actualDelivery","estimatedDelivery"
    FROM "Shipment"
    WHERE "shipmentNumber" LIKE 'SHP-LOCAL%' OR "shipmentNumber" LIKE 'WR%'
    ORDER BY "shipmentNumber" LIMIT 200;`);
  let shDelivered = 0, shPending = 0;
  for (const s of sh) {
    if (s.actualDelivery) shDelivered++; else shPending++;
  }
  console.log(`\nShipment Neon table rows = ${sh.length}`);
  console.log(`   delivered actualDelivery SET = ${shDelivered} · pending = ${shPending}`);

  // 3) Wafae TEMU canonical proof check — WR-001..007 in ProcItem (not Shipment, settledAt col not deployed — use receiptConfirmedAt + deliveredAt + status)
  const wr = await prisma.$queryRawUnsafe(`
    SELECT "orderRef","recipientName",status,"receiptConfirmedAt","deliveredAt","supplierName"
    FROM "ProcurementItem"
    WHERE "orderRef" LIKE 'WR-%' OR "supplierName" ILIKE '%temu%'
    ORDER BY "orderRef" LIMIT 20;`);
  console.log(`\nTEMU / WR ProcurementItem canonical rows = ${wr.length} (settled Sep 27 v3.5.3)`);
  for (const w of wr) console.log(`   ${w.orderRef} · ${w.recipientName} · ${w.status} · delivered=${!!w.deliveredAt} receipted=${!!w.receiptConfirmedAt}`);

  // 4) OwnerAccount CIN pin verification — OWNER Younes Tsouli CIN A337773 (real col: countryCode, not country)
  const accts = await prisma.$queryRawUnsafe(`
    SELECT id,label,"accountNumberLast","accountHolder","countryCode" as country,
           "spendableBalance","heldBalance","totalSent","totalReceived",currency
    FROM "OwnerAccount" WHERE "isActive"=true;`);
  console.log(`\nOwnerAccount (CIN truth check):`);
  for (const a of accts) {
    const cin = /A\d{6}/.exec(a.accountHolder || '')?.[0] || (a.label || '').match(/A\d{6}/)?.[0] || '—';
    console.log(`   ${a.label.padEnd(40).slice(0,40)} last=${String(a.accountNumberLast).padEnd(4)} holder=${a.accountHolder || '—'} CIN=${cin}  totalSent=${Number(a.totalSent||0).toFixed(2)} ${a.currency}`);
  }
  const ytAccount = accts.find(a => /BC646|Banking Circle|646/.test(String(a.accountNumberLast)+String(a.label)));
  if (ytAccount) {
    const cin = /A\d{6}/.exec(ytAccount.accountHolder || '')?.[0] || '—';
    console.log(`\nOWNER Younes Tsouli PRIMARY ACCOUNT (646 Banking Circle): CIN in holder = ${cin}`);
    console.log(`   User 2026-09-28 pin: should be A337773 (45 Av Ibn Sina Appt 4 Rabat Agdal Contentieux 018)`);
    if (cin === 'A337773') console.log('   ✅ MATCH');
    else console.log('   ⚠️  NO MATCH — database column accountHolder text has no CIN A337773 (address book MT103 already patched to A337773; not a DB write this run).');
  }

  await prisma.$disconnect();
  await pool.end();
  console.log(`\n✔ FAIL-CLOSED audit complete. 0 DB writes. 0 fabricated confirmations.`);
  console.log(`  User decision: "hesitate to phone Hind/Bachir/Wafae → honoured as NO OP."`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(2); });
