-- HOLE #2: PayoutItem proof columns (fail-closed for status=completed, same pattern as OwnerSettlement)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'PayoutItem' AND column_name = 'externalRef') THEN
    ALTER TABLE "PayoutItem" ADD COLUMN "externalRef" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'PayoutItem' AND column_name = 'connectorId') THEN
    ALTER TABLE "PayoutItem" ADD COLUMN "connectorId" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'PayoutItem' AND column_name = 'connectorStatus') THEN
    ALTER TABLE "PayoutItem" ADD COLUMN "connectorStatus" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'PayoutItem' AND column_name = 'proofHash') THEN
    ALTER TABLE "PayoutItem" ADD COLUMN "proofHash" TEXT;
  END IF;
END $$;

-- HOLE #5: Neon-safe row-level trigger — REJECTS status=completed on ANY of 4 ledger tables unless proof fields are REAL (non-empty, non-synthetic)
-- This runs AFTER the ORM middleware (TRUTH guards) — so even if a bug bypasses Prisma middleware (raw SQL, DB admin, third-party tools) the DB itself still blocks phantom-completed writes.
CREATE OR REPLACE FUNCTION prevent_phantom_completed_status()
RETURNS TRIGGER AS $$
DECLARE
  v_status TEXT;
  v_externalRef TEXT;
  v_proofHash TEXT;
  v_connectorStatus TEXT;
  v_transactionRef TEXT;
  v_providerBatchRef TEXT;
  v_paypalBatchId TEXT;
  v_txHash TEXT;
  v_recipientAddress TEXT;
  v_dataSource TEXT;
  v_has_real_ref BOOLEAN := FALSE;
  v_has_synthetic_ref BOOLEAN := FALSE;
  v_ref_under_test TEXT;
BEGIN
  -- Determine new status based on table
  IF TG_TABLE_NAME = 'OwnerSettlement' THEN
    v_status := NEW."status";
    v_externalRef := NEW."externalRef";
    v_proofHash := NEW."proofHash";
    v_connectorStatus := NEW."connectorStatus";
    v_dataSource := NEW."dataSource";
    v_ref_under_test := v_externalRef;
  ELSIF TG_TABLE_NAME = 'PayoutBatch' THEN
    v_status := NEW."status";
    v_providerBatchRef := NEW."providerBatchRef";
    v_paypalBatchId := NEW."paypalBatchId";
    v_proofHash := NEW."proofHash";
    v_ref_under_test := COALESCE(v_providerBatchRef, v_paypalBatchId);
  ELSIF TG_TABLE_NAME = 'PayoutItem' THEN
    v_status := NEW."status";
    v_externalRef := NEW."externalRef";
    v_transactionRef := NEW."transactionRef";
    v_proofHash := NEW."proofHash";
    v_connectorStatus := NEW."connectorStatus";
    v_ref_under_test := COALESCE(v_externalRef, v_transactionRef);
  ELSIF TG_TABLE_NAME = 'RevenueEvent' THEN
    v_status := NEW."status";
    v_proofHash := NEW."proofHash";
  ELSIF TG_TABLE_NAME = 'CryptoSettlement' THEN
    v_status := NEW."status";
    v_txHash := NEW."txHash";
    v_recipientAddress := NEW."recipientAddress";
    v_ref_under_test := v_txHash;
  ELSIF TG_TABLE_NAME = 'ProcurementItem' THEN
    v_status := NEW."status";
    v_proofHash := NEW."deliveryProofHash";
    v_ref_under_test := v_proofHash;
  ELSE
    RETURN NEW;
  END IF;

  -- Only enforce for 'completed' / 'confirmed' / 'verified' / 'settled' / 'delivered' / 'received' / 'LIVE_SETTLED'
  IF v_status IS NULL OR v_status NOT IN ('completed','confirmed','verified','settled','delivered','received','LIVE_SETTLED') THEN
    RETURN NEW;
  END IF;

  -- Check reference for synthetic/local fabrication patterns (exact same regexes as ORM isSyntheticRef)
  IF v_ref_under_test IS NOT NULL THEN
    v_ref_under_test := UPPER(TRIM(v_ref_under_test));
    IF (v_ref_under_test ~ '^(PB-|RECOVER(Y|ED)-|REV-|PP-\d+|ALT-|REC-|PROC-)')
       OR (v_ref_under_test ~ 'R\d+-.{6,}')
       OR (v_ref_under_test ~ '^(REVIEWED|MISPLACED|INSTRUCTIONS_READY|WAITING_MANUAL)') THEN
      v_has_synthetic_ref := TRUE;
    END IF;
  END IF;

  -- Table-specific rules (same as ORM TRUTH rules, mirrored at SQL level)
  IF TG_TABLE_NAME = 'OwnerSettlement' THEN
    v_has_real_ref := (v_externalRef IS NOT NULL AND TRIM(v_externalRef) <> '' AND NOT v_has_synthetic_ref);
    IF NOT v_has_real_ref THEN
      RAISE EXCEPTION 'OWNER_SETTLEMENT_PHANTOM_COMPLETED: OwnerSettlement.status=completed blocked. externalRef is NULL/empty/synthetic ("%"). Provide a real provider receipt (PayPal txn, MT103, onchain hash).', COALESCE(v_externalRef, '<null>');
    END IF;
    IF v_dataSource IS NOT NULL AND LOWER(v_dataSource) LIKE '%internal_ledger_only%' THEN
      RAISE EXCEPTION 'OWNER_SETTLEMENT_PHANTOM_COMPLETED: OwnerSettlement.dataSource="%" is not allowed for status=completed; must reference a live rail (live_onchain, live_bank_api, live_paypal_api, etc.).', v_dataSource;
    END IF;
    IF v_proofHash IS NULL AND (v_connectorStatus IS NULL OR LOWER(v_connectorStatus) NOT IN ('live','verified','manual_attested_finance','live_onchain','live_bank_api','live_paypal_api','live_stripe_api','live_wise_api')) THEN
      RAISE EXCEPTION 'OWNER_SETTLEMENT_PHANTOM_COMPLETED: OwnerSettlement requires proofHash OR connectorStatus ∈ {live,verified,manual_attested_finance} for status=completed.';
    END IF;
  ELSIF TG_TABLE_NAME = 'PayoutBatch' THEN
    v_has_real_ref := ((v_providerBatchRef IS NOT NULL AND TRIM(v_providerBatchRef) <> '') OR (v_paypalBatchId IS NOT NULL AND TRIM(v_paypalBatchId) <> '')) AND NOT v_has_synthetic_ref;
    IF NOT v_has_real_ref THEN
      RAISE EXCEPTION 'PAYOUT_BATCH_PHANTOM_COMPLETED: PayoutBatch.status=completed blocked. providerBatchRef or paypalBatchId required (real provider ref, not synthetic "%").', COALESCE(v_providerBatchRef, v_paypalBatchId, '<null>');
    END IF;
    IF v_proofHash IS NULL THEN
      RAISE EXCEPTION 'PAYOUT_BATCH_PHANTOM_COMPLETED: PayoutBatch.status=completed requires proofHash.';
    END IF;
  ELSIF TG_TABLE_NAME = 'PayoutItem' THEN
    v_has_real_ref := (((v_externalRef IS NOT NULL AND TRIM(v_externalRef) <> '') OR (v_transactionRef IS NOT NULL AND TRIM(v_transactionRef) <> '')) AND NOT v_has_synthetic_ref);
    IF NOT v_has_real_ref THEN
      RAISE EXCEPTION 'PAYOUT_ITEM_PHANTOM_COMPLETED: PayoutItem.status=completed blocked. transactionRef/externalRef is NULL/empty/synthetic ("%"). Use status=processing_awaiting_manual_receipt until real receipt provided.', COALESCE(v_externalRef, v_transactionRef, '<null>');
    END IF;
    IF v_proofHash IS NULL AND (v_connectorStatus IS NULL OR LOWER(v_connectorStatus) NOT IN ('live','verified','manual_attested_finance','live_onchain','live_bank_api','live_paypal_api','live_stripe_api','live_wise_api')) THEN
      RAISE EXCEPTION 'PAYOUT_ITEM_PHANTOM_COMPLETED: PayoutItem requires proofHash OR connectorStatus ∈ {live,verified,manual_attested_finance} for status=completed.';
    END IF;
  ELSIF TG_TABLE_NAME = 'RevenueEvent' THEN
    IF v_proofHash IS NULL THEN
      RAISE EXCEPTION 'REVENUE_EVENT_PHANTOM_COMPLETED: RevenueEvent.status=% requires proofHash.', v_status;
    END IF;
  ELSIF TG_TABLE_NAME = 'CryptoSettlement' THEN
    IF v_txHash IS NULL OR TRIM(v_txHash) = '' THEN
      RAISE EXCEPTION 'CRYPTO_SETTLEMENT_PHANTOM_COMPLETED: CryptoSettlement.confirmed requires txHash (real on-chain transaction hash).';
    END IF;
    IF v_recipientAddress IS NULL OR TRIM(v_recipientAddress) = '' THEN
      RAISE EXCEPTION 'CRYPTO_SETTLEMENT_PHANTOM_COMPLETED: CryptoSettlement.confirmed requires recipientAddress (actual destination wallet prevents lost funds).';
    END IF;
  ELSIF TG_TABLE_NAME = 'ProcurementItem' THEN
    IF v_status IN ('delivered','received') AND v_proofHash IS NULL THEN
      RAISE EXCEPTION 'PROCUREMENT_PHANTOM_DELIVERED: ProcurementItem.delivered/received requires deliveryProofHash.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Install triggers on each table (idempotent — DROP IF EXISTS first)
DROP TRIGGER IF EXISTS trg_prevent_phantom_ownersettlement ON "OwnerSettlement";
CREATE TRIGGER trg_prevent_phantom_ownersettlement
BEFORE INSERT OR UPDATE OF "status", "externalRef", "proofHash", "connectorStatus", "dataSource" ON "OwnerSettlement"
FOR EACH ROW EXECUTE FUNCTION prevent_phantom_completed_status();

DROP TRIGGER IF EXISTS trg_prevent_phantom_payoutbatch ON "PayoutBatch";
CREATE TRIGGER trg_prevent_phantom_payoutbatch
BEFORE INSERT OR UPDATE OF "status", "providerBatchRef", "paypalBatchId", "proofHash" ON "PayoutBatch"
FOR EACH ROW EXECUTE FUNCTION prevent_phantom_completed_status();

DROP TRIGGER IF EXISTS trg_prevent_phantom_payoutitem ON "PayoutItem";
CREATE TRIGGER trg_prevent_phantom_payoutitem
BEFORE INSERT OR UPDATE OF "status", "transactionRef", "externalRef", "proofHash", "connectorStatus" ON "PayoutItem"
FOR EACH ROW EXECUTE FUNCTION prevent_phantom_completed_status();

DROP TRIGGER IF EXISTS trg_prevent_phantom_revenueevent ON "RevenueEvent";
CREATE TRIGGER trg_prevent_phantom_revenueevent
BEFORE INSERT OR UPDATE OF "status", "proofHash" ON "RevenueEvent"
FOR EACH ROW EXECUTE FUNCTION prevent_phantom_completed_status();

DROP TRIGGER IF EXISTS trg_prevent_phantom_cryptosettlement ON "CryptoSettlement";
CREATE TRIGGER trg_prevent_phantom_cryptosettlement
BEFORE INSERT OR UPDATE OF "status", "txHash", "recipientAddress" ON "CryptoSettlement"
FOR EACH ROW EXECUTE FUNCTION prevent_phantom_completed_status();

DROP TRIGGER IF EXISTS trg_prevent_phantom_procurementitem ON "ProcurementItem";
CREATE TRIGGER trg_prevent_phantom_procurementitem
BEFORE INSERT OR UPDATE OF "status", "deliveryProofHash" ON "ProcurementItem"
FOR EACH ROW EXECUTE FUNCTION prevent_phantom_completed_status();
