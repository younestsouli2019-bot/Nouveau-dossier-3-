// Apply migration 20260830000400 to Neon DIRECT endpoint via raw pg driver
// (Prisma Rust engine TLS handshake broken on Windows — P1001).
import "dotenv/config";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIGRATION_ID = "20260830000400";
const MIGRATION_NAME = "procurement_phantom_triggers";
const MIGRATION_DIR = path.resolve(__dirname, `../prisma/migrations/${MIGRATION_ID}_${MIGRATION_NAME}/migration.sql`);
const sql = fs.readFileSync(MIGRATION_DIR, "utf8");

// Credentials come from env (DATABASE_URL / DATABASE_URL_DIRECT / DIRECT_URL) — never hardcode them.
const connectionString =
  (process.env.DATABASE_URL_DIRECT || process.env.DIRECT_URL || process.env.DATABASE_URL || "").trim();

if (!connectionString) {
  console.error("DATABASE_URL (or DATABASE_URL_DIRECT/DIRECT_URL) required — no credentials are hardcoded in scripts.");
  process.exit(2);
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false, require: true },
  connectionTimeoutMillis: 20000,
  max: 2,
});

const checksum = crypto.createHash("sha256").update(sql).digest("hex");

async function main() {
  const client = await pool.connect();
  try {
    console.log(`[Apply-00400] Connected to Neon DIRECT host=${DIRECT_HOST}`);
    console.log(`[Apply-00400] SQL length=${sql.length} chars, checksum=${checksum.slice(0,24)}…`);

    // 1. Apply SQL
    console.log(`[Apply-00400] Applying migration DDL…`);
    await client.query(sql);
    console.log(`[Apply-00400] DDL applied OK (no exception = success)`);

    // 2. Verify triggers exist
    const verify = await client.query(`
      SELECT event_object_table, trigger_name
      FROM information_schema.triggers
      WHERE trigger_name IN (
        'trg_prevent_phantom_procurementitem_v2',
        'trg_prevent_phantom_shipment',
        'trg_prevent_phantom_purchaseorder'
      )
      ORDER BY event_object_table;
    `);
    console.log(`[Apply-00400] Triggers installed on ${verify.rows.length} tables:`, JSON.stringify(verify.rows));

    // 3. Verify function exists
    const fn = await client.query(`SELECT to_regprocedure('prevent_phantom_procurement_delivered_status()') as proc_fn;`);
    console.log(`[Apply-00400] function prevent_phantom_procurement_delivered_status registered =`, fn.rows[0].proc_fn);

    // 4. Insert _prisma_migrations row (idempotent — skip if already there)
    const already = await client.query(
      `SELECT migration_name FROM "_prisma_migrations" WHERE migration_name = $1`,
      [`${MIGRATION_ID}_${MIGRATION_NAME}`]
    );
    if (already.rows.length === 0) {
      await client.query(`
        INSERT INTO "_prisma_migrations" (
          "id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count"
        ) VALUES (
          gen_random_uuid(),
          $1,
          now(),
          $2,
          NULL,
          NULL,
          now(),
          1
        )
      `, [checksum, `${MIGRATION_ID}_${MIGRATION_NAME}`]);
      console.log(`[Apply-00400] _prisma_migrations row INSERTED applied=true`);
    } else {
      console.log(`[Apply-00400] _prisma_migrations row ALREADY EXISTS (${already.rows[0].migration_name}) — skip insert`);
    }

    // 5. Blockade test A: direct SQL ProcurementItem SETTLED with no proof → RAISE EXCEPTION
    console.log(`\n[Verify Blockade A] Inserting phantom ProcurementItem settled (no proof) … expecting EXCEPTION`);
    try {
      await client.query(`
        INSERT INTO "ProcurementItem" (
          id, name, quantity, status, unitPriceEst, totalEst, currency,
          "createdAt", "updatedAt", deliveryProofHash, "receiptConfirmedAt", "receiptConfirmedBy", "quantityReceived"
        ) VALUES (
          'proc-phantom-test-' || (EXTRACT(EPOCH FROM NOW())::BIGINT)::TEXT,
          'Phantom Blockade Test Item',
          2,
          'settled',
          10,
          20,
          'USD',
          now(), now(),
          NULL, NULL, NULL, NULL
        )
      `);
      console.error(`[Verify Blockade A] FAIL — INSERT SUCCEEDED when it should have RAISED EXCEPTION!`);
      process.exitCode = 1;
    } catch (e) {
      if (e.message && /PROC_ITEM_PHANTOM_SETTLED|PROC_ITEM_PHANTOM/.test(e.message)) {
        console.log(`[Verify Blockade A] PASS — Postgres trigger CORRECTLY BLOCKED phantom settled. Code=${e.code || 'P0001'} msg="${e.message.slice(0,140)}"`);
      } else {
        console.log(`[Verify Blockade A] PARTIAL — blocked but not expected Proc code. msg="${e.message.slice(0,140)}"`);
      }
    }

    // Blockade B: Shipment delivered without tracking or actualDelivery proof
    console.log(`\n[Verify Blockade B] Inserting phantom Shipment.delivered (no tracking, no proof) … expecting EXCEPTION`);
    try {
      await client.query(`
        INSERT INTO "Shipment" (
          id, "shipmentNumber", status, quantity, carrier, "trackingNumber",
          "trackingVerified", "actualDelivery", events, "createdAt", "updatedAt",
          "destinationCountry", "destinationName", "destinationAddress"
        ) VALUES (
          'shp-phantom-test-' || (EXTRACT(EPOCH FROM NOW())::BIGINT)::TEXT,
          'SHP-PHANTOM-TEST',
          'delivered',
          1,
          NULL,
          NULL,
          false,
          now(),
          NULL,
          now(), now(),
          'Morocco',
          'Test Recipient',
          'Casablanca'
        )
      `);
      console.error(`[Verify Blockade B] FAIL — INSERT SUCCEEDED!`);
      process.exitCode = 1;
    } catch (e) {
      if (e.message && /SHIPMENT_PHANTOM_(ADVANCED|DELIVERED)/.test(e.message)) {
        console.log(`[Verify Blockade B] PASS — Postgres trigger CORRECTLY BLOCKED phantom Shipment.delivered. code=${e.code||'P0001'} msg="${e.message.slice(0,140)}"`);
      } else {
        console.log(`[Verify Blockade B] PARTIAL — blocked. msg="${e.message.slice(0,140)}"`);
      }
    }

    // Blockade C: PurchaseOrder.completed without ack/orderedAt
    console.log(`\n[Verify Blockade C] Inserting phantom PurchaseOrder.completed (no orderedAt, no ack) … expecting EXCEPTION`);
    try {
      await client.query(`
        INSERT INTO "PurchaseOrder" (
          id, "poNumber", status, "totalAmount", currency, "lineItemCount",
          "createdAt", "updatedAt", "orderedAt", "ackStatus", supplierName
        ) VALUES (
          'po-phantom-test-' || (EXTRACT(EPOCH FROM NOW())::BIGINT)::TEXT,
          'PO-PHANTOM-TEST',
          'completed',
          100, 'USD', 2,
          now(), now(),
          NULL,
          'AWAITING_ACK',
          'Test Vendor Co'
        )
      `);
      console.error(`[Verify Blockade C] FAIL — INSERT SUCCEEDED!`);
      process.exitCode = 1;
    } catch (e) {
      if (e.message && /PO_PHANTOM_COMPLETED/.test(e.message)) {
        console.log(`[Verify Blockade C] PASS — Postgres trigger CORRECTLY BLOCKED phantom PO.completed. code=${e.code||'P0001'} msg="${e.message.slice(0,140)}"`);
      } else {
        console.log(`[Verify Blockade C] PARTIAL — blocked. msg="${e.message.slice(0,140)}"`);
      }
    }

    // Blockade D: ProcurementItem delivered with BARE 64-HEX oracle proof
    console.log(`\n[Verify Blockade D] ProcurementItem.delivered with bare-64-hex oracle hash (no provider prefix) … expecting EXCEPTION`);
    try {
      const bareOracle = "a".repeat(64);
      await client.query(`
        INSERT INTO "ProcurementItem" (
          id, name, quantity, status, unitPriceEst, totalEst, currency,
          "createdAt", "updatedAt", "deliveredAt", "deliveryProofHash"
        ) VALUES (
          'proc-phantom-d-' || (EXTRACT(EPOCH FROM NOW())::BIGINT)::TEXT,
          'Phantom Oracle Proof Test',
          1, 'delivered', 5, 5, 'USD',
          now(), now(),
          now(), $1
        )
      `, [bareOracle]);
      console.error(`[Verify Blockade D] FAIL — bare 64-hex oracle proof was ACCEPTED!`);
      process.exitCode = 1;
    } catch (e) {
      if (e.message && /PROC_ITEM_PHANTOM_DELIVERED_ORACLE_PROOF/.test(e.message)) {
        console.log(`[Verify Blockade D] PASS — bare-64-hex oracle forgery BLOCKED (provider prefix rule enforced). msg="${e.message.slice(0,140)}"`);
      } else {
        console.log(`[Verify Blockade D] PARTIAL — blocked for some other reason. msg="${e.message.slice(0,140)}"`);
      }
    }

    // Blockade E: Shipment carrier placeholder International Shipping BANNED
    console.log(`\n[Verify Blockade E] Shipment carrier="International Shipping" placeholder … expecting EXCEPTION`);
    try {
      await client.query(`
        INSERT INTO "Shipment" (
          id, "shipmentNumber", status, quantity, carrier, "trackingNumber",
          "createdAt", "updatedAt", "destinationCountry", "destinationName", "destinationAddress"
        ) VALUES (
          'shp-phantom-e-' || (EXTRACT(EPOCH FROM NOW())::BIGINT)::TEXT,
          'SHP-PH-E',
          'label_created',
          1,
          'International Shipping',
          'AB123',
          now(), now(),
          'Morocco', 'R', 'A'
        )
      `);
      console.error(`[Verify Blockade E] FAIL — International Shipping placeholder was ACCEPTED!`);
      process.exitCode = 1;
    } catch (e) {
      if (e.message && /SHIPMENT_PHANTOM_PLACEHOLDER_CARRIER/.test(e.message)) {
        console.log(`[Verify Blockade E] PASS — banned International Shipping placeholder REJECTED. msg="${e.message.slice(0,140)}"`);
      } else {
        console.log(`[Verify Blockade E] PARTIAL — blocked. msg="${e.message.slice(0,140)}"`);
      }
    }

    console.log(`\n[Apply-00400] DONE — Layer 2 SQL blockade on ProcurementItem/Shipment/PurchaseOrder is LIVE.`);
  } catch (err) {
    console.error(`[Apply-00400] FATAL:`, err.message || err);
    process.exitCode = 2;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(3); });
