-- S5-T01: Provider Evidence Hardening Migration (5 PARTS)
-- PART A: quarantine table for existing duplicate provider_txid rows BEFORE creating UNIQUE indexes
CREATE TABLE IF NOT EXISTS provider_txid_duplicates_quarantine (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    table_name TEXT NOT NULL,
    provider_txid TEXT NOT NULL,
    duplicate_count INTEGER NOT NULL DEFAULT 2,
    kept_row_id TEXT,
    discarded_row_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    quarantined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    resolution_notes TEXT
);

-- PART B: Create @unique indexes AFTER quarantine copy (groupwise dedup by keeping min id)
--     5 tables: Payout / PayoutItem / TransactionLog / OwnerSettlement / CryptoSettlement

-- 1) Payout.providerTransactionId -> UNIQUE (duplicates first quarantined)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='payout' AND column_name='providertransactionid'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE tablename='payout' AND indexname LIKE '%providertxid%uniq%'
    ) THEN
        -- Quarantine duplicates
        INSERT INTO provider_txid_duplicates_quarantine (table_name, provider_txid, duplicate_count, kept_row_id, discarded_row_ids, resolution_notes)
        SELECT 'Payout', p."providerTransactionId", COUNT(*), MIN(p.id),
               ARRAY_AGG(p.id ORDER BY p.id) FILTER (WHERE p.id != MIN(p.id) OVER (PARTITION BY p."providerTransactionId")),
               'Auto-quarantined during 20261006 provider_txid UNIQUE migration'
        FROM "Payout" p
        WHERE p."providerTransactionId" IS NOT NULL
        GROUP BY p."providerTransactionId"
        HAVING COUNT(*) > 1;

        -- Delete duplicates (keep min id)
        DELETE FROM "Payout" WHERE id IN (
            SELECT unnest(discarded_row_ids) FROM provider_txid_duplicates_quarantine WHERE table_name='Payout'
        );

        CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS payout_provider_txid_uniq
            ON "Payout"("providerTransactionId") WHERE "providerTransactionId" IS NOT NULL;
    END IF;
END $$;

-- 2) PayoutItem.providerTransactionId
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='payoutitem' AND column_name='providertransactionid'
    ) THEN
        CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS payoutitem_provider_txid_uniq
            ON "PayoutItem"("providerTransactionId") WHERE "providerTransactionId" IS NOT NULL;
    END IF;
END $$;

-- 3) TransactionLog.providerTxId
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='transactionlog' AND column_name='providertxid'
    ) THEN
        CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS txlog_provider_txid_uniq
            ON "TransactionLog"("providerTxId") WHERE "providerTxId" IS NOT NULL;
    END IF;
END $$;

-- 4) OwnerSettlement.providerTxId (or similarly named)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='ownersettlement' AND column_name IN ('providertxid','providertransactionid')
    ) THEN
        CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ownersettlement_provider_txid_uniq
            ON "OwnerSettlement"("providerTxId") WHERE "providerTxId" IS NOT NULL;
    END IF;
END $$;

-- 5) CryptoSettlement.providerTxId
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='cryptosettlement' AND column_name IN ('providertxid','providertransactionid','txhash')
    ) THEN
        CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS cryptosettlement_provider_txid_uniq
            ON "CryptoSettlement"("txHash") WHERE "txHash" IS NOT NULL;
    END IF;
END $$;

-- PART C: Native Postgres enum for 5 strict payout states + cast legacy strings via CASE
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payout_status_t') THEN
        CREATE TYPE payout_status_t AS ENUM (
            'initiated',
            'pending',
            'completed',
            'failed',
            'needs_manual_proof'
        );
    END IF;
END $$;

--     Apply column cast from legacy String -> payout_status_t with CASE map
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='payout' AND column_name='status' AND data_type='text'
    ) AND EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'payout_status_t'
    ) THEN
        ALTER TABLE "Payout"
            ALTER COLUMN status TYPE payout_status_t
            USING CASE
                WHEN LOWER(status) IN ('created','submitted','initiated','queued') THEN 'initiated'::payout_status_t
                WHEN LOWER(status) IN ('pending','pending_approval','processing','authorized','pending_provider') THEN 'pending'::payout_status_t
                WHEN LOWER(status) IN ('completed','paid','settled','success','confirmed') THEN 'completed'::payout_status_t
                WHEN LOWER(status) IN ('failed','declined','rejected','cancelled','canceled','error') THEN 'failed'::payout_status_t
                ELSE 'needs_manual_proof'::payout_status_t
            END;
        ALTER TABLE "Payout" ALTER COLUMN status SET DEFAULT 'initiated'::payout_status_t;
    END IF;
END $$;

-- PART D: ADD provider_raw_payload JSONB + provider_signature TEXT columns to Payout
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='payout' AND column_name='providerrawpayload'
    ) THEN
        ALTER TABLE "Payout" ADD COLUMN providerRawPayload JSONB;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='payout' AND column_name='providersignature'
    ) THEN
        ALTER TABLE "Payout" ADD COLUMN providerSignature TEXT;
    END IF;
END $$;

-- PART E: PL/pgSQL trigger trg_payout_completed_requires_proof
--         RAISE EXCEPTION when status='completed' WITHOUT providerRawPayload (jsonb OBJECT, not scalar/null)
--         AND WITHOUT providerSignature text length >= 16
CREATE OR REPLACE FUNCTION trg_payout_completed_requires_proof_fn()
RETURNS TRIGGER AS $$
DECLARE
    payload_is_object BOOLEAN;
BEGIN
    IF NEW.status = 'completed'::payout_status_t THEN
        payload_is_object := (jsonb_typeof(NEW."providerRawPayload") = 'object');
        IF NEW."providerRawPayload" IS NULL OR payload_is_object IS NOT TRUE THEN
            RAISE EXCEPTION 'Payout status cannot be set completed without providerRawPayload (JSONB object) and providerSignature (>=16 chars). Got raw_payload jsonb_typeof=%',
                COALESCE(jsonb_typeof(NEW."providerRawPayload"), 'NULL');
        END IF;
        IF NEW."providerSignature" IS NULL OR CHAR_LENGTH(TRIM(NEW."providerSignature")) < 16 THEN
            RAISE EXCEPTION 'Payout status cannot be set completed without providerSignature (>=16 chars). Got len=%',
                CHAR_LENGTH(COALESCE(NEW."providerSignature", ''));
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payout_completed_requires_proof ON "Payout";
CREATE TRIGGER trg_payout_completed_requires_proof
BEFORE INSERT OR UPDATE OF status, "providerRawPayload", "providerSignature" ON "Payout"
FOR EACH ROW EXECUTE FUNCTION trg_payout_completed_requires_proof_fn();

-- PART F (S5-T02) DFA transition trigger: ONLY 6 legal transitions, raise on others
CREATE OR REPLACE FUNCTION trg_payout_status_transition_dfa_fn()
RETURNS TRIGGER AS $$
DECLARE
    allowed BOOLEAN := FALSE;
    old_s payout_status_t;
    new_s payout_status_t;
BEGIN
    IF OLD.status IS NULL THEN
        RETURN NEW;
    END IF;
    old_s := OLD.status;
    new_s := NEW.status;
    IF old_s = new_s THEN
        RETURN NEW;
    END IF;
    -- 6 LEGAL transitions (spec §5 S5-T02):
    -- initiated -> pending
    -- pending   -> completed
    -- pending   -> failed
    -- pending   -> needs_manual_proof
    -- needs_manual_proof -> pending
    -- needs_manual_proof -> failed
    allowed := (
        (old_s = 'initiated'::payout_status_t AND new_s = 'pending'::payout_status_t) OR
        (old_s = 'pending'::payout_status_t AND new_s = 'completed'::payout_status_t) OR
        (old_s = 'pending'::payout_status_t AND new_s = 'failed'::payout_status_t) OR
        (old_s = 'pending'::payout_status_t AND new_s = 'needs_manual_proof'::payout_status_t) OR
        (old_s = 'needs_manual_proof'::payout_status_t AND new_s = 'pending'::payout_status_t) OR
        (old_s = 'needs_manual_proof'::payout_status_t AND new_s = 'failed'::payout_status_t)
    );
    IF NOT allowed THEN
        RAISE EXCEPTION 'Illegal payout status transition: % -> %', old_s::text, new_s::text;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payout_status_transition_dfa ON "Payout";
CREATE TRIGGER trg_payout_status_transition_dfa
BEFORE UPDATE OF status ON "Payout"
FOR EACH ROW EXECUTE FUNCTION trg_payout_status_transition_dfa_fn();
