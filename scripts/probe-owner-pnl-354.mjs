#!/usr/bin/env node
import 'dotenv/config';
import { Client } from 'pg';

const ok = process.env.DATABASE_URL?.length >= 80;
console.log(`[probe-owner-pnl-354] DATABASE_URL len=${process.env.DATABASE_URL?.length ?? 0} ${ok ? 'OK' : 'FAIL'}`);
if (!ok) { console.error('ERROR: need DATABASE_URL'); process.exit(1); }

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const fmt = (n, curr = 'USD') => `${(Number(n ?? 0)).toFixed(2)} ${curr}`;
const r2 = n => Math.round((Number(n ?? 0) + Number.EPSILON) * 100) / 100;

async function q(sql, params = []) {
  const r = await c.query(sql, params);
  return r.rows;
}

try {
  console.log('\n=== Outbound OwnerSettlement (JOIN OwnerAccount for label/RIB) ===');
  const osRows = await q(`
    SELECT a.id as account_id,
           COALESCE(a.label, a."accountNumberLast", '?') as label,
           a."accountNumberLast" as rib_last,
           a."accountType",
           os.currency, os.status, os."connectorStatus",
           COUNT(*)::int as rows,
           SUM(os.amount)::float as amount
    FROM "OwnerSettlement" os
    LEFT JOIN "OwnerAccount" a ON a.id = os."ownerAccountId"
    GROUP BY 1,2,3,4,5,6,7
    ORDER BY 2,5,6,7`);
  console.log(`${'label'.padEnd(34)} RIB  type${' '.padEnd(10)} curr status       conn${' '.padEnd(22)} rows  amount`);
  const outPerOwner = {};
  for (const r of osRows) {
    const key = `${r.account_id ?? 'no-acc'}|${r.currency}`;
    if (!outPerOwner[key]) outPerOwner[key] = { label: r.label, currency: r.currency, total: 0, rows_done: 0 };
    if (r.status === 'completed' || (r.connectorStatus && (r.connectorStatus.includes('auto_attested') || r.connectorStatus.includes('finance')))) {
      outPerOwner[key].total += r.amount;
    }
    if (r.status === 'completed') outPerOwner[key].rows_done += r.rows;
    console.log(`${String(r.label).padEnd(34).slice(0,34)} ${String(r.rib_last || '').padEnd(4)} ${String(r.accountType||'').padEnd(14).slice(0,14)} ${String(r.currency).padEnd(4)} ${String(r.status).padEnd(12)} ${String(r.connectorStatus||'').padEnd(28).slice(0,28)} ${String(r.rows).padStart(4)} ${fmt(r.amount, r.currency)}`);
  }
  let outboundTotalUsd = 0;
  for (const o of Object.values(outPerOwner)) {
    const usd = o.currency === 'MAD' ? r2(o.total) * 0.1 : r2(o.total);
    outboundTotalUsd += usd;
  }
  console.log(`TOTAL outbound ~$${r2(outboundTotalUsd).toFixed(2)} (MAD converted @0.1)`);

  console.log('\n=== Inbound RevenueEvent ===');
  const revRows = await q(`
    SELECT COALESCE(currency,'USD') as currency, status, COALESCE(source,'?') as src,
           COUNT(*)::int as rows,
           SUM(amount)::float as amount
    FROM "RevenueEvent"
    GROUP BY 1,2,3
    ORDER BY 1,2,3`);
  console.log(`${'curr'.padEnd(4)} ${'status'.padEnd(12)} ${'source'.padEnd(20)} rows amount`);
  let inboundUsd = 0;
  for (const r of revRows) {
    const usd = r.currency === 'MAD' ? r2(r.amount) * 0.1 : r2(r.amount);
    inboundUsd += usd;
    console.log(`${String(r.currency).padEnd(4)} ${String(r.status).padEnd(12)} ${String(r.src).padEnd(20).slice(0,20)} ${String(r.rows).padStart(4)} ${fmt(r.amount, r.currency)}`);
  }
  console.log(`TOTAL inbound  ~$${r2(inboundUsd).toFixed(2)}`);

  console.log('\n=== OwnerAccount ledger (Neon source of truth) ===');
  const accRows = await q(`SELECT id, COALESCE(label, "accountNumberLast",'?') as label,
                                  "accountNumberLast" as rib, "accountType", currency,
                                  "totalSent"::float as sent, "totalReceived"::float as recv,
                                  COALESCE("heldBalance",0)::float as held, COALESCE("spendableBalance",0)::float as sp,
                                  COALESCE("txCount",0)::int as txn
                           FROM "OwnerAccount" WHERE "isActive"=true ORDER BY label`);
  const grandSent = accRows.reduce((s, a) => s + (a.currency === 'MAD' ? r2(a.sent) * 0.1 : r2(a.sent)), 0);
  const grandRecv = accRows.reduce((s, a) => s + (a.currency === 'MAD' ? r2(a.recv) * 0.1 : r2(a.recv)), 0);
  console.log(`${'label'.padEnd(34)} RIB  ${'type'.padEnd(14)} curr totalSent totalReceived held   spendable txn`);
  for (const a of accRows) {
    console.log(`${String(a.label).padEnd(34).slice(0,34)} ${String(a.rib||'').padEnd(4)} ${String(a.accountType||'').padEnd(14).slice(0,14)} ${String(a.currency).padEnd(4)} ${fmt(a.sent,a.currency).padStart(12)} ${fmt(a.recv,a.currency).padStart(12)} ${fmt(a.held,a.currency).padStart(8)} ${fmt(a.sp,a.currency).padStart(10)} ${String(a.txn).padStart(4)}`);
  }
  console.log(`OwnerAccount sum: sent=$${r2(grandSent).toFixed(2)} recv=$${r2(grandRecv).toFixed(2)} (MAD @0.1)`);

  console.log('\n=== ProcurementItems: PO receipt gap by recipientName ===');
  const procRows = await q(`
    SELECT COALESCE("recipientName",'?') as name,
           status, COUNT(*)::int as rows,
           SUM(CASE WHEN "deliveryProofHash" IS NULL THEN 1 ELSE 0 END)::int as missing_proof,
           SUM(CASE WHEN "receiptConfirmedAt" IS NULL THEN 1 ELSE 0 END)::int as missing_receipt,
           SUM("totalEst")::float as total_est,
           currency
    FROM "ProcurementItem"
    GROUP BY 1,2,7
    ORDER BY 1,2`);
  console.log(`${'name'.padEnd(28)} status${' '.padEnd(8)} rows missing_proof missing_receipt est_total`);
  for (const r of procRows) {
    console.log(`${String(r.name).padEnd(28).slice(0,28)} ${String(r.status).padEnd(14)} ${String(r.rows).padStart(4)} ${String(r.missing_proof).padStart(13)} ${String(r.missing_receipt).padStart(15)} ${fmt(r.total_est, r.currency)}`);
  }

  console.log('\n=== TEMU WR Shipment deliveries (source of Wafae 7/7 settled proof) ===');
  const wrRows = await q(`
    SELECT "shipmentNumber" as ref, status, "actualDelivery",
           "destinationName", COALESCE("carrier",'no-carrier') as carrier, notes
    FROM "Shipment"
    WHERE "shipmentNumber" LIKE 'WR-%' OR notes LIKE '%TEMU%' OR "destinationAddress" LIKE '%Agdal%'
    ORDER BY ref`);
  console.log(`${'ref'.padEnd(10)} ${'status'.padEnd(14)} actualDelivery          destName               carrier item`);
  for (const r of wrRows) {
    const item = r.notes || '';
    console.log(`${String(r.ref).padEnd(10)} ${String(r.status).padEnd(14)} ${String(r.actualDelivery ?? '').padEnd(23).slice(0,23)} ${String(r.destinationName ?? '').padEnd(22).slice(0,22)} ${String(r.carrier||'').padEnd(18).slice(0,18)} ${String(item).slice(0, 38)}`);
  }

  const gap = r2(outboundTotalUsd - inboundUsd);
  console.log(`\nNET (Outbound ~$${r2(outboundTotalUsd).toFixed(2)}) - (Inbound ~$${r2(inboundUsd).toFixed(2)}) = Δ ~$${gap.toFixed(2)}`);
  if (Math.abs(gap) > 200) console.log('⚠️ ENTITLEMENT GAP (informational only) — see OwnerAccount.totalReceived above for authoritative balance');
  process.exit(0);
} catch (e) {
  console.error('[probe-owner-pnl-354] ERROR', e?.message ?? e);
  process.exit(1);
} finally {
  await c.end();
}
