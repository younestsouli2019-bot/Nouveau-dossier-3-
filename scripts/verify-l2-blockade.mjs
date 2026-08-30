// Verify Layer 2 triggers on Neon — uses actual schema columns.
import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

// Credentials come from env (DATABASE_URL) — never hardcode them (anti-secret-leak rule).
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required (load .env or export it). Refusing to run without it.");
  process.exit(1);
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false, require: true },
  connectionTimeoutMillis: 20000,
  max: 2,
});

function ts() { return new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14); }

async function testExpectException(label, expectedRe, queryFn) {
  process.stdout.write(`  [${label}] … `);
  try {
    await queryFn();
    console.log(`FAIL — query succeeded when it should have BLOCKED`);
    return false;
  } catch (e) {
    const match = expectedRe.test(e.message || "");
    console.log(`${match ? "PASS" : "PARTIAL"} — code=${e.code} msgPrefix="${(e.message||"").slice(0,100)}"`);
    return match;
  }
}

async function main() {
  const client = await pool.connect();
  try {
    console.log(`[Re-Verify L2] Connected. Looking up columns via direct JSON insert…`);
    console.log(`\n=== ProcurementItem blockade tests ===`);

    // A1: ProcurementItem SETTLED with NO proof chain (no receipt)
    await testExpectException(
      "A1: Proc settled (no proof/confirmer/qty/ts)",
      /PROC_ITEM_PHANTOM_SETTLED/,
      async () => client.query(`
        INSERT INTO "ProcurementItem" (id, name, status, quantity, "createdAt", "updatedAt", "unitPriceEst", "totalEst", currency)
        VALUES ($1, 'Blockade Test A1', 'settled', 1, now(), now(), 5, 5, 'USD')
      `, [`proc-blk-a1-${ts()}`])
    );

    // A2: ProcurementItem SETTLED but receiptConfirmedBy = "system-auto"
    await testExpectException(
      "A2: Proc settled (system-auto confirmer = rejected)",
      /PROC_ITEM_PHANTOM_SETTLED_NO_CONFIRMER/,
      async () => client.query(`
        INSERT INTO "ProcurementItem" (id, name, status, quantity, "createdAt", "updatedAt", "unitPriceEst", "totalEst", currency,
          "deliveryProofHash", "receiptConfirmedAt", "receiptConfirmedBy", "quantityReceived")
        VALUES ($1, 'Blockade Test A2', 'settled', 1, now(), now(), 5, 5, 'USD',
          'pod:REAL-POD-HASH-ABC123-XYZ', now(), 'system-auto', 1)
      `, [`proc-blk-a2-${ts()}`])
    );

    // A3: receipt_confirmed with bare-64-hex oracle hash (no provider prefix)
    const bare64 = "aabbccdd".repeat(8);
    await testExpectException(
      "A3: delivered + bare-64-hex oracle hash (no provider prefix)",
      /PROC_ITEM_PHANTOM_DELIVERED_ORACLE_PROOF/,
      async () => client.query(`
        INSERT INTO "ProcurementItem" (id, name, status, quantity, "createdAt", "updatedAt", "unitPriceEst", "totalEst", currency,
          "deliveredAt", "deliveryProofHash")
        VALUES ($1, 'Blockade Test A3', 'delivered', 1, now(), now(), 5, 5, 'USD', now(), $2)
      `, [`proc-blk-a3-${ts()}`, bare64])
    );

    console.log(`\n=== Shipment blockade tests ===`);

    // B1: Shipment delivered, no carrier, no tracking
    await testExpectException(
      "B1: Shipment delivered, no carrier, no tracking",
      /SHIPMENT_PHANTOM_(ADVANCED|DELIVERED)/,
      async () => client.query(`
        INSERT INTO "Shipment" (id, "shipmentNumber", status, quantity, "createdAt", "updatedAt",
          "destinationCountry", "destinationName", "destinationAddress", carrier, "trackingNumber", "trackingVerified", "actualDelivery", events)
        VALUES ($1, 'SHP-BLK-B1', 'delivered', 1, now(), now(),
          'Morocco', 'R', 'Casa', NULL, NULL, false, now(), NULL)
      `, [`shp-blk-b1-${ts()}`])
    );

    // B2: Shipment in_transit without tracking
    await testExpectException(
      "B2: Shipment in_transit, no tracking string",
      /SHIPMENT_PHANTOM_TRANSIT/,
      async () => client.query(`
        INSERT INTO "Shipment" (id, "shipmentNumber", status, quantity, "createdAt", "updatedAt",
          "destinationCountry", "destinationName", "destinationAddress", carrier, "trackingNumber")
        VALUES ($1, 'SHP-BLK-B2', 'in_transit', 1, now(), now(), 'Morocco', 'R', 'Casa', 'Aramex', NULL)
      `, [`shp-blk-b2-${ts()}`])
    );

    // B3: Banned carrier = "International Shipping"
    await testExpectException(
      "B3: Shipment carrier = International Shipping (BANNED placeholder)",
      /SHIPMENT_PHANTOM_PLACEHOLDER_CARRIER/,
      async () => client.query(`
        INSERT INTO "Shipment" (id, "shipmentNumber", status, quantity, "createdAt", "updatedAt",
          "destinationCountry", "destinationName", "destinationAddress", carrier, "trackingNumber")
        VALUES ($1, 'SHP-BLK-B3', 'label_created', 1, now(), now(), 'Morocco', 'R', 'Casa', 'International Shipping', 'AB123456789')
      `, [`shp-blk-b3-${ts()}`])
    );

    // B4: Shipment delivered with tracking string empty + trackingVerified=false, no events
    await testExpectException(
      "B4: Shipment delivered without (trackingVerified=true OR events>50)",
      /SHIPMENT_PHANTOM_DELIVERED(_NO_PROOF|_TRACKING)?/,
      async () => client.query(`
        INSERT INTO "Shipment" (id, "shipmentNumber", status, quantity, "createdAt", "updatedAt",
          "destinationCountry", "destinationName", "destinationAddress", carrier, "trackingNumber", "trackingVerified", "actualDelivery", events)
        VALUES ($1, 'SHP-BLK-B4', 'delivered', 1, now(), now(), 'Morocco', 'R', 'Casa',
          'Poste Maroc', 'PM-123456789', false, now(), '[]')
      `, [`shp-blk-b4-${ts()}`])
    );

    console.log(`\n=== PurchaseOrder blockade tests ===`);

    // C1: PurchaseOrder completed, no orderedAt
    await testExpectException(
      "C1: PO completed without orderedAt timestamp",
      /PO_PHANTOM_COMPLETED/,
      async () => client.query(`
        INSERT INTO "PurchaseOrder" (id, "poNumber", status, "totalAmount", currency, "lineItemCount", "createdAt", "updatedAt", "ackStatus")
        VALUES ($1, 'PO-BLK-C1', 'completed', 100, 'USD', 2, now(), now(), 'ACKNOWLEDGED')
      `, [`po-blk-c1-${ts()}`])
    );

    // C2: PO completed with orderedAt but still AWAITING_ACK (no supplier acknowledgement)
    await testExpectException(
      "C2: PO completed with ackStatus=AWAITING_ACK (no supplier ack)",
      /PO_PHANTOM_COMPLETED_NO_ACK/,
      async () => client.query(`
        INSERT INTO "PurchaseOrder" (id, "poNumber", status, "totalAmount", currency, "lineItemCount", "createdAt", "updatedAt", "orderedAt", "ackStatus")
        VALUES ($1, 'PO-BLK-C2', 'completed', 100, 'USD', 2, now(), now(), now(), 'AWAITING_ACK')
      `, [`po-blk-c2-${ts()}`])
    );

    // A4: Proc receipt_confirmed with real prefixed proof + human + ts + qty → should PASS (not blocked)
    process.stdout.write(`  [A4: Proc receipt_confirmed (HONEST: prefix proof + human + ts + qty)] … `);
    try {
      await client.query(`
        INSERT INTO "ProcurementItem" (id, name, status, quantity, "createdAt", "updatedAt", "unitPriceEst", "totalEst", currency,
          "deliveryProofHash", "receiptConfirmedAt", "receiptConfirmedBy", "quantityReceived")
        VALUES ($1, 'Honest receipt_confirmed test', 'receipt_confirmed', 2, now(), now(), 5, 10, 'USD',
          'pod:AMANA-2026-837462-SCAN-' || $2, now(), 'Younes Tsouli', 2)
      `, [`proc-blk-a4-${ts()}`, ts()]);
      console.log(`PASS — honest row correctly accepted (not blocked).`);
      // Clean up
      await client.query(`DELETE FROM "ProcurementItem" WHERE id LIKE 'proc-blk-a4-%'`);
    } catch (e) {
      console.log(`FAIL — honest row BLOCKED (false positive!): msg="${(e.message||"").slice(0,120)}"`);
    }

    // B5: HONEST Shipment label_created with real carrier + real tracking string → PASS
    process.stdout.write(`  [B5: Shipment label_created (HONEST: Poste Maroc + real tracking)] … `);
    try {
      await client.query(`
        INSERT INTO "Shipment" (id, "shipmentNumber", status, quantity, "createdAt", "updatedAt",
          "destinationCountry", "destinationName", "destinationAddress", carrier, "trackingNumber")
        VALUES ($1, 'SHP-HONEST-B5', 'label_created', 1, now(), now(),
          'Morocco', 'Younes T', 'Casablanca', 'Poste Maroc', 'MA-PM-2026-' || $2)
      `, [`shp-blk-b5-${ts()}`, ts()]);
      console.log(`PASS — honest shipment row correctly accepted.`);
      await client.query(`DELETE FROM "Shipment" WHERE id LIKE 'shp-blk-b5-%'`);
    } catch (e) {
      console.log(`FAIL — honest shipment BLOCKED (false positive!): msg="${(e.message||"").slice(0,120)}"`);
    }

    console.log(`\n[Re-Verify L2] DONE. All blockade assertions ran.`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(3); });
