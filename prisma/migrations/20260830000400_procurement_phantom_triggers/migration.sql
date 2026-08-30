-- MIGRATION 20260830000400: PROCUREMENT + SHIPMENT + PURCHASE ORDER anti-phantom triggers
-- Layer 2 of the triple-defence (ORM TRUTH-009..014 fail-closed + SQL BEFORE row triggers + daemon L3 sweep).
-- Mirrors all rules in src/lib/strict-enforcement/truth-guards.ts ProcurementItem/shipment/purchaseorder cases
-- plus the sovereign ruling 2026-08-29 procurement-truth-reconciled (175 items falsely settled, 48 fabricated shipments).

-- ── Step 1: ensure proof/referenced columns exist IF NOT EXISTS (idempotent guard against Postgres 42703)
DO $$
BEGIN
  -- ProcurementItem columns (trigger UPDATE OF clause — must all exist or trigger DDL aborts)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ProcurementItem' AND column_name = 'deliveryProofHash') THEN
    ALTER TABLE "ProcurementItem" ADD COLUMN "deliveryProofHash" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ProcurementItem' AND column_name = 'supplierName') THEN
    ALTER TABLE "ProcurementItem" ADD COLUMN "supplierName" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ProcurementItem' AND column_name = 'orderRef') THEN
    ALTER TABLE "ProcurementItem" ADD COLUMN "orderRef" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ProcurementItem' AND column_name = 'shippedAt') THEN
    ALTER TABLE "ProcurementItem" ADD COLUMN "shippedAt" TIMESTAMP(3);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ProcurementItem' AND column_name = 'deliveredAt') THEN
    ALTER TABLE "ProcurementItem" ADD COLUMN "deliveredAt" TIMESTAMP(3);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ProcurementItem' AND column_name = 'receiptConfirmedAt') THEN
    ALTER TABLE "ProcurementItem" ADD COLUMN "receiptConfirmedAt" TIMESTAMP(3);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ProcurementItem' AND column_name = 'receiptConfirmedBy') THEN
    ALTER TABLE "ProcurementItem" ADD COLUMN "receiptConfirmedBy" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ProcurementItem' AND column_name = 'quantityReceived') THEN
    ALTER TABLE "ProcurementItem" ADD COLUMN "quantityReceived" INTEGER;
  END IF;

  -- Shipment columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Shipment' AND column_name = 'carrier') THEN
    ALTER TABLE "Shipment" ADD COLUMN "carrier" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Shipment' AND column_name = 'trackingNumber') THEN
    ALTER TABLE "Shipment" ADD COLUMN "trackingNumber" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Shipment' AND column_name = 'trackingVerified') THEN
    ALTER TABLE "Shipment" ADD COLUMN "trackingVerified" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Shipment' AND column_name = 'events') THEN
    ALTER TABLE "Shipment" ADD COLUMN "events" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Shipment' AND column_name = 'actualDelivery') THEN
    ALTER TABLE "Shipment" ADD COLUMN "actualDelivery" TIMESTAMP(3);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Shipment' AND column_name = 'trackingUrl') THEN
    ALTER TABLE "Shipment" ADD COLUMN "trackingUrl" TEXT;
  END IF;

  -- PurchaseOrder columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'PurchaseOrder' AND column_name = 'orderedAt') THEN
    ALTER TABLE "PurchaseOrder" ADD COLUMN "orderedAt" TIMESTAMP(3);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'PurchaseOrder' AND column_name = 'acknowledgedAt') THEN
    ALTER TABLE "PurchaseOrder" ADD COLUMN "acknowledgedAt" TIMESTAMP(3);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'PurchaseOrder' AND column_name = 'ackStatus') THEN
    ALTER TABLE "PurchaseOrder" ADD COLUMN "ackStatus" TEXT;
  END IF;
END $$;

-- ── Step 2: unified PL/pgSQL trigger function for procurement anti-phantom defence
-- Covers ProcurementItem (5 states), Shipment (3 states), PurchaseOrder (completed).
-- Exact regex parity with ORM isSyntheticRef / isSyntheticOracleHash.
CREATE OR REPLACE FUNCTION prevent_phantom_procurement_delivered_status()
RETURNS TRIGGER AS $$
DECLARE
  v_status TEXT;
  v_status_low TEXT;
  -- ProcurementItem vars
  v_supplierName TEXT;
  v_orderRef TEXT;
  v_deliveryProofHash TEXT;
  v_shippedAt TIMESTAMP;
  v_deliveredAt TIMESTAMP;
  v_receiptConfirmedAt TIMESTAMP;
  v_receiptConfirmedBy TEXT;
  v_quantityReceived INTEGER;
  -- Shipment vars
  v_carrier TEXT;
  v_trackingNumber TEXT;
  v_trackingVerified BOOLEAN;
  v_events TEXT;
  v_actualDelivery TIMESTAMP;
  v_trackingUrl TEXT;
  -- PurchaseOrder vars
  v_orderedAt_PO TIMESTAMP;
  v_ackStatus_PO TEXT;
  v_acknowledgedAt_PO TIMESTAMP;
  -- helpers
  v_hash_trim TEXT;
  v_by_low TEXT;
BEGIN
  v_status := NEW."status";
  IF v_status IS NULL THEN RETURN NEW; END IF;
  v_status_low := LOWER(v_status);

  IF TG_TABLE_NAME = 'ProcurementItem' THEN
    v_supplierName     := NEW."supplierName";
    v_orderRef         := NEW."orderRef";
    v_deliveryProofHash:= NEW."deliveryProofHash";
    v_shippedAt        := NEW."shippedAt";
    v_deliveredAt      := NEW."deliveredAt";
    v_receiptConfirmedAt   := NEW."receiptConfirmedAt";
    v_receiptConfirmedBy   := NEW."receiptConfirmedBy";
    v_quantityReceived := NEW."quantityReceived";

    -- shipped / in_transit: require supplierName OR orderRef (real shipment anchor)
    IF v_status_low IN ('shipped','in_transit') AND v_shippedAt IS NOT NULL THEN
      IF (v_supplierName IS NULL OR TRIM(v_supplierName) = '') AND (v_orderRef IS NULL OR TRIM(v_orderRef) = '') THEN
        RAISE EXCEPTION 'PROC_ITEM_PHANTOM_SHIPPED: ProcurementItem.status=% with shippedAt set requires real supplierName or orderRef (jumia.ma/avito.ma/poste.ma/amana/aramex/dhl etc.). supplier="%" orderRef="%".', v_status, COALESCE(v_supplierName,'<null>'), COALESCE(v_orderRef,'<null>');
      END IF;
    END IF;

    -- delivered / received / completed: require deliveryProofHash, AND reject bare 64-hex oracle forgery
    IF v_status_low IN ('delivered','received','completed','confirmed') AND v_deliveredAt IS NOT NULL THEN
      IF v_deliveryProofHash IS NULL OR TRIM(v_deliveryProofHash) = '' THEN
        RAISE EXCEPTION 'PROC_ITEM_PHANTOM_DELIVERED: ProcurementItem.delivered requires deliveryProofHash (POD photo hash, carrier scan SHA with provider prefix pod:/scan:/AMANA-/POSTE-/JUMIA-/0x). proofHash="<null>".';
      END IF;
      v_hash_trim := TRIM(v_deliveryProofHash);
      IF v_hash_trim ~ '^[a-fA-F0-9]{64}$' THEN
        RAISE EXCEPTION 'PROC_ITEM_PHANTOM_DELIVERED_ORACLE_PROOF: ProcurementItem.delivered deliveryProofHash is a BARE 64-hex SHA-256 (no provider prefix = locally-forged oracle proof). Got "%"… — prepend real provider label (pod:/scan:/AMANA-/POSTE-/0x) or leave status=ordered until real POD obtained.', SUBSTRING(v_hash_trim FROM 1 FOR 16);
      END IF;
    END IF;

    -- receipt_confirmed: quad chain — real proof + non-system-auto confirmer + ts + positive qty
    IF v_status_low = 'receipt_confirmed' THEN
      v_hash_trim := COALESCE(TRIM(v_deliveryProofHash), '');
      IF v_hash_trim = '' OR v_hash_trim ~ '^[a-fA-F0-9]{64}$' THEN
        RAISE EXCEPTION 'PROC_ITEM_PHANTOM_RECEIPT: ProcurementItem.receipt_confirmed requires REAL external deliveryProofHash with provider prefix. Got "%".', CASE WHEN v_hash_trim = '' THEN '<null>' ELSE SUBSTRING(v_hash_trim FROM 1 FOR 16)||'…(bare 64-hex oracle)' END;
      END IF;
      v_by_low := LOWER(COALESCE(TRIM(v_receiptConfirmedBy), ''));
      IF v_by_low = '' OR v_by_low = 'system-auto' THEN
        RAISE EXCEPTION 'PROC_ITEM_PHANTOM_RECEIPT_NO_CONFIRMER: ProcurementItem.receipt_confirmed requires receiptConfirmedBy = real human (not null, not "system-auto"). Got "%".', COALESCE(v_receiptConfirmedBy,'<null>');
      END IF;
      IF v_receiptConfirmedAt IS NULL THEN
        RAISE EXCEPTION 'PROC_ITEM_PHANTOM_RECEIPT_NO_TS: ProcurementItem.receipt_confirmed requires receiptConfirmedAt timestamp.';
      END IF;
      IF v_quantityReceived IS NULL OR v_quantityReceived <= 0 THEN
        RAISE EXCEPTION 'PROC_ITEM_PHANTOM_RECEIPT_NO_QTY: ProcurementItem.receipt_confirmed requires quantityReceived > 0 (items actually received from carrier/Poste Maroc/Amana). Got %.', COALESCE(v_quantityReceived::TEXT,'<null>');
      END IF;
    END IF;

    -- settled: entire quad receipt chain must have been written (same as receipt_confirmed)
    IF v_status_low = 'settled' THEN
      v_hash_trim := COALESCE(TRIM(v_deliveryProofHash), '');
      IF v_hash_trim = '' OR v_hash_trim ~ '^[a-fA-F0-9]{64}$' THEN
        RAISE EXCEPTION 'PROC_ITEM_PHANTOM_SETTLED: ProcurementItem.settled requires real deliveryProofHash populated at receipt_confirmed step. proofHash="%".', CASE WHEN v_hash_trim = '' THEN '<null>' ELSE SUBSTRING(v_hash_trim FROM 1 FOR 16)||'…(bare 64-hex oracle)' END;
      END IF;
      IF v_receiptConfirmedAt IS NULL THEN
        RAISE EXCEPTION 'PROC_ITEM_PHANTOM_SETTLED_NO_RECEIPT_TS: ProcurementItem.settled requires receiptConfirmedAt (go through receipt_confirmed first).';
      END IF;
      v_by_low := LOWER(COALESCE(TRIM(v_receiptConfirmedBy), ''));
      IF v_by_low = '' OR v_by_low = 'system-auto' OR LENGTH(TRIM(v_receiptConfirmedBy)) < 3 THEN
        RAISE EXCEPTION 'PROC_ITEM_PHANTOM_SETTLED_NO_CONFIRMER: ProcurementItem.settled requires receiptConfirmedBy real human (len>=3, not system-auto). Got "%".', COALESCE(v_receiptConfirmedBy,'<null>');
      END IF;
      IF v_quantityReceived IS NULL OR v_quantityReceived <= 0 THEN
        RAISE EXCEPTION 'PROC_ITEM_PHANTOM_SETTLED_NO_QTY: ProcurementItem.settled requires quantityReceived > 0.';
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'Shipment' THEN
    v_carrier           := NEW."carrier";
    v_trackingNumber    := NEW."trackingNumber";
    v_trackingVerified  := NEW."trackingVerified";
    v_events            := NEW."events";
    v_actualDelivery    := NEW."actualDelivery";
    v_trackingUrl       := NEW."trackingUrl";

    -- Placeholder carrier labels BANNED (TRUTH-012-PLACEHOLDER) — never write these
    IF v_carrier IS NOT NULL AND v_carrier ~* '(international shipping|multi-carrier)' THEN
      RAISE EXCEPTION 'SHIPMENT_PHANTOM_PLACEHOLDER_CARRIER: Shipment.carrier "%"" is BANNED placeholder (International Shipping / Multi-carrier). Set carrier=NULL until real carrier known, or write Poste Maroc/Amana/Aramex/DHL/FedEx/UPS/Chronopost.', v_carrier;
    END IF;

    -- label_created / picked_up / in_transit / customs / out_for_delivery: require carrier OR tracking
    IF v_status_low IN ('label_created','picked_up','in_transit','customs','out_for_delivery','delivered','returned','failed') THEN
      IF (v_carrier IS NULL OR TRIM(v_carrier) = '' OR v_carrier ~* '(international shipping|multi-carrier)') AND (v_trackingNumber IS NULL OR LENGTH(TRIM(v_trackingNumber)) < 3) THEN
        RAISE EXCEPTION 'SHIPMENT_PHANTOM_ADVANCED: Shipment.status=% requires real carrier (Poste Maroc/Amana/Aramex/DHL/FedEx/UPS/Chronopost) OR real trackingNumber (len>=3). carrier="%" tracking="%".', v_status, COALESCE(v_carrier,'<null>'), COALESCE(v_trackingNumber,'<null>');
      END IF;
    END IF;

    -- in_transit / customs / out_for_delivery: REQUIRE real tracking (len>=3)
    IF v_status_low IN ('in_transit','customs','out_for_delivery') THEN
      IF v_trackingNumber IS NULL OR LENGTH(TRIM(v_trackingNumber)) < 3 THEN
        RAISE EXCEPTION 'SHIPMENT_PHANTOM_TRANSIT: Shipment.status=% requires real trackingNumber (length>=3). tracking="%". Use carrier-acquire-sweep to paste Poste Maroc/Amana/Jumia tracking first.', v_status, COALESCE(v_trackingNumber,'<null>');
      END IF;
    END IF;

    -- delivered: actualDelivery set → require tracking (>=3) + (verified=true OR events JSON > 50 chars)
    IF v_status_low = 'delivered' AND v_actualDelivery IS NOT NULL THEN
      IF v_trackingNumber IS NULL OR LENGTH(TRIM(v_trackingNumber)) < 3 THEN
        RAISE EXCEPTION 'SHIPMENT_PHANTOM_DELIVERED: Shipment.delivered with actualDelivery requires trackingNumber (real carrier-tracked parcel len>=3). tracking="%".', COALESCE(v_trackingNumber,'<null>');
      END IF;
      IF (v_trackingVerified IS NOT TRUE) AND (v_events IS NULL OR LENGTH(TRIM(v_events)) <= 50) THEN
        RAISE EXCEPTION 'SHIPMENT_PHANTOM_DELIVERED_NO_PROOF: Shipment.delivered requires EITHER trackingVerified=true (real carrier API returned delivered event) OR events JSON populated with real scan data (len>50 chars). Paste real delivered event scan into events column, or call /api/carrier-tracking to flip trackingVerified, only then mark status=delivered.';
      END IF;
    END IF;

    -- trackingUrl written but no trackingNumber → warn-only (soft guard; non-fatal but blocked via URLNOREF ORM)
    IF v_trackingUrl IS NOT NULL AND TRIM(v_trackingUrl) <> '' AND (v_trackingNumber IS NULL OR TRIM(v_trackingNumber) = '') THEN
      -- Non-fatal at SQL level (matches TRUTH-012-URLNOREF non-fatal). Warn via NOTICE only.
      RAISE NOTICE 'SHIPMENT_URLNOREF: Shipment.trackingUrl written but trackingNumber empty — URL meaningless without a ref.';
    END IF;

  ELSIF TG_TABLE_NAME = 'PurchaseOrder' THEN
    v_orderedAt_PO      := NEW."orderedAt";
    v_ackStatus_PO      := NEW."ackStatus";
    v_acknowledgedAt_PO := NEW."acknowledgedAt";

    -- completed: must have orderedAt AND supplier ack evidence
    IF v_status_low = 'completed' THEN
      IF v_orderedAt_PO IS NULL THEN
        RAISE EXCEPTION 'PO_PHANTOM_COMPLETED: PurchaseOrder.status=completed requires orderedAt timestamp (PO was never ordered). orderedAt=<null>.';
      END IF;
      IF (v_ackStatus_PO IS NULL OR UPPER(TRIM(v_ackStatus_PO)) NOT IN ('ACKNOWLEDGED','RESOLVED','DELIVERED','RECEIVED')) AND v_acknowledgedAt_PO IS NULL THEN
        RAISE EXCEPTION 'PO_PHANTOM_COMPLETED_NO_ACK: PurchaseOrder.completed without supplier acknowledgement. ackStatus="%" acknowledgedAt=%. Leave status=ordered until supplier on jumia.ma/avito.ma/superfood.ma/marjanemall.ma/brico.ma confirms.', COALESCE(v_ackStatus_PO,'<null>'), COALESCE(v_acknowledgedAt_PO::TEXT,'<null>');
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Step 3: install BEFORE INSERT/UPDATE row-level triggers (idempotent DROP IF EXISTS)
DROP TRIGGER IF EXISTS trg_prevent_phantom_procurementitem_v2 ON "ProcurementItem";
CREATE TRIGGER trg_prevent_phantom_procurementitem_v2
BEFORE INSERT OR UPDATE OF
  "status", "supplierName", "orderRef", "deliveryProofHash",
  "shippedAt", "deliveredAt", "receiptConfirmedAt", "receiptConfirmedBy", "quantityReceived"
ON "ProcurementItem"
FOR EACH ROW EXECUTE FUNCTION prevent_phantom_procurement_delivered_status();

DROP TRIGGER IF EXISTS trg_prevent_phantom_shipment ON "Shipment";
CREATE TRIGGER trg_prevent_phantom_shipment
BEFORE INSERT OR UPDATE OF
  "status", "carrier", "trackingNumber", "trackingVerified", "events", "actualDelivery", "trackingUrl"
ON "Shipment"
FOR EACH ROW EXECUTE FUNCTION prevent_phantom_procurement_delivered_status();

DROP TRIGGER IF EXISTS trg_prevent_phantom_purchaseorder ON "PurchaseOrder";
CREATE TRIGGER trg_prevent_phantom_purchaseorder
BEFORE INSERT OR UPDATE OF
  "status", "orderedAt", "ackStatus", "acknowledgedAt"
ON "PurchaseOrder"
FOR EACH ROW EXECUTE FUNCTION prevent_phantom_procurement_delivered_status();
