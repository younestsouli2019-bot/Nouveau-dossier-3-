import 'dotenv/config';
import { Client } from 'pg';
import fs from 'fs';
import { randomBytes, randomUUID } from 'crypto';

const OFFLINE = 'C:/Users/Dell/AppData/Local/Temp/opencode/swarm-tb/db/base44-offline-store.json';
const j = JSON.parse(fs.readFileSync(OFFLINE, 'utf8'));
const e = j.entities;

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, p = []) => (await c.query(sql, p)).rows;
const q1 = async (sql, p = []) => (await c.query(sql, p)).rows[0];

// Recompute the dedupe plan identically to the analysis (guarantees no double-book)
const dbItems = await q(`SELECT "recipientEmail","recipientName",amount,currency FROM "PayoutItem"`);
const dbKey = new Set(dbItems.map(i => `${(i.recipientEmail||i.recipientName||'').toLowerCase()}|${Number(i.amount)}|${String(i.currency).toUpperCase()}`));
const payToInsert = e.PayoutItem.filter(it => {
  const key = `${String(it.recipient||'').toLowerCase()}|${Number(it.amount)}|${String(it.currency||'').toUpperCase()}`;
  return !dbKey.has(key);
});

const dbRev = await q(`SELECT source, amount, currency FROM "RevenueEvent" WHERE status='confirmed'`);
const dbRevKey = new Set(dbRev.map(r => `${String(r.source||'').toLowerCase()}|${Number(r.amount)}|${String(r.currency||'').toUpperCase()}`));
const confToInsert = e.RevenueEvent.filter(r =>
  (r.status||'').toLowerCase() === 'confirmed' &&
  !dbRevKey.has(`${String(r.source||'').toLowerCase()}|${Number(r.amount)}|${String(r.currency||'').toUpperCase()}`)
);
const projected = e.RevenueEvent.filter(r => (r.status||'').toLowerCase() !== 'confirmed');

try {
  await c.query('BEGIN');

  // 1) Consolidated carrier batch for imported offline items
  const batch = await q1(
    `INSERT INTO "PayoutBatch" (id, "batchNumber","totalAmount","currency","status","itemCount","notes","paymentProvider","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),now()) RETURNING id`,
    [
      randomUUID(),
      'PB-CONSOL-OFFLINE-001',
      Number(payToInsert.reduce((s,i)=>s+Number(i.amount||0),0).toFixed(2)),
      'USD',
      'needs_manual_proof',
      payToInsert.length,
      'Consolidated import from Z.ai offline store (workspace-52b995fb). All items fail-closed: no real externalRef/proofHash.',
      'internal_ledger',
    ]
  );

  // 2) Insert payout items (fail-closed)
  let items = 0;
  for (const it of payToInsert) {
    const recEmail = String(it.recipient || '').match(/@/) ? it.recipient : null;
    await q(
      `INSERT INTO "PayoutItem" (id, "payoutBatchId","batchNumber","recipientName","recipientEmail","amount","currency","status","paymentMethod","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),now())`,
      [
        randomUUID(), batch.id, 'PB-CONSOL-OFFLINE-001',
        it.name || 'Unknown recipient',
        recEmail || (String(it.recipient || '')),
        Number(it.amount), String(it.currency || 'USD'),
        'needs_manual_proof',
        it.method === 'bank_account' ? 'bank_wire' : 'paypal',
      ]
    );
    items++;
  }

  // 3) Insert offline "confirmed" revenue as PENDING only (no real proof → must NOT be 'confirmed')
  //    Truth-guard blocks status=confirmed without proofHash; we honor it by importing as pending.
  let rev = 0;
  for (const r of confToInsert) {
    await q(
      `INSERT INTO "RevenueEvent" (id, source, amount, currency, status, description, "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,now(),now()) RETURNING id`,
      [randomUUID(), r.source, Number(r.amount), String(r.currency||'USD'), 'pending', r.description||`Revenue ${r.event_id}`]
    );
    rev++;
  }

  // 4) Quarantine record for projected phantom events
  await q(
    `INSERT INTO "AuditLedger" (id, "entityType","entityId","action","proofHash","dataSource","performedBy","metadata","createdAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())`,
    [
      randomUUID(),
      'revenue_projected_quarantine',
      'consolidation-offline',
      'quarantined_projected_events',
      'quarantine:' + randomBytes(6).toString('hex'),
      'internal_ledger_only',
      'consolidation-engine',
      JSON.stringify({ count: projected.length, totalAmount: Number(projected.reduce((s,r)=>s+Number(r.amount||0),0).toFixed(2)), note: 'projected/mission_completed micro-events not imported (not confirmed revenue).' }),
    ]
  );

  await c.query('COMMIT');
  console.log(JSON.stringify({ ok: true, batchId: batch.id, payoutItemsInserted: items, revenueInserted: rev, projectedQuarantined: projected.length }, null, 2));
} catch (err) {
  await c.query('ROLLBACK');
  console.log(JSON.stringify({ ok: false, error: err.message }, null, 2));
  process.exitCode = 1;
}
await c.end();
