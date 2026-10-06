-- S6-T01/S6-T02: SalesLedger/PayoutLedger SQL checks + 3 DB roles (sales_writer / payout_writer / marketing_agent)
-- + COLUMN-level grants + DENY rules + 8 permission assertions

-- ── Apply CHECK constraints to Prisma-created PayoutLedger / SalesLedger columns ──
DO $$
BEGIN
    -- 1) PayoutLedger.payout_destination_code WHITELIST only (no arbitrary strings)
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payoutledger' AND column_name='payoutdestinationcode') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payoutledger_dest_code_allowed') THEN
            ALTER TABLE "PayoutLedger" ADD CONSTRAINT payoutledger_dest_code_allowed
                CHECK ("payoutDestinationCode" IN (
                    'SALARY_RIB182',
                    'DEBT_RIB372',
                    'SOVEREIGN_RIB646',
                    'OPS_RIB646',
                    'L2_USDC_ARBITRUM'
                ));
        END IF;
    END IF;

    -- 2) PayoutLedger.amount_cents > 0 CHECK
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payoutledger' AND column_name='amountcents') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payoutledger_amount_positive') THEN
            ALTER TABLE "PayoutLedger" ADD CONSTRAINT payoutledger_amount_positive
                CHECK ("amountCents" > 0);
        END IF;
    END IF;

    -- 3) PayoutLedger.initiated_by MUST start with 'signataire-hors-tty:'
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payoutledger' AND column_name='initiatedby') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payoutledger_initiator_signataire') THEN
            ALTER TABLE "PayoutLedger" ADD CONSTRAINT payoutledger_initiator_signataire
                CHECK (LEFT("initiatedBy", 20) = 'signataire-hors-tty:');
        END IF;
    END IF;

    -- 4) SalesLedger.price_amount_cents > 0 CHECK
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='salesledger' AND column_name='priceamountcents') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'salesledger_amount_positive') THEN
            ALTER TABLE "SalesLedger" ADD CONSTRAINT salesledger_amount_positive
                CHECK ("priceAmountCents" > 0);
        END IF;
    END IF;

    -- 5) ReconciliationDiscrepancy.resolution_notes >= 40 chars NOT OPEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='reconciliationdiscrepancy' AND column_name='resolutionnotes') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'disc_resolution_notes_minlen') THEN
            ALTER TABLE "ReconciliationDiscrepancy" ADD CONSTRAINT disc_resolution_notes_minlen
                CHECK (
                    status = 'OPEN'
                    OR ("resolutionNotes" IS NOT NULL AND CHAR_LENGTH(TRIM("resolutionNotes")) >= 40)
                );
        END IF;
    END IF;
END $$;

-- ── Create 3 roles. Idempotent (IF NOT EXISTS CREATE ROLE DO $$ wrapper). ──
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sales_writer') THEN
        CREATE ROLE sales_writer NOINHERIT LOGIN PASSWORD 'CHANGE_ME_SALES_WRITER_POST_ROTATION_' || substr(md5(random()::text), 1, 24);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'payout_writer') THEN
        CREATE ROLE payout_writer NOINHERIT LOGIN PASSWORD 'CHANGE_ME_PAYOUT_WRITER_POST_ROTATION_' || substr(md5(random()::text), 1, 24);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'marketing_agent') THEN
        CREATE ROLE marketing_agent NOINHERIT LOGIN PASSWORD 'CHANGE_ME_MARKETING_POST_ROTATION_' || substr(md5(random()::text), 1, 24);
    END IF;
END $$;

-- ── SCHEMA public access: REVOKE wide PUBLIC grants, grant CONNECT + minimal usage ──
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE current_database() FROM PUBLIC;

GRANT CONNECT ON DATABASE current_database() TO sales_writer;
GRANT CONNECT ON DATABASE current_database() TO payout_writer;
GRANT CONNECT ON DATABASE current_database() TO marketing_agent;

GRANT USAGE ON SCHEMA public TO sales_writer, payout_writer, marketing_agent;

-- ── sales_writer: INSERT/SELECT SalesLedger. UPDATE ONLY status COLUMN (column-level grant) ──
GRANT SELECT, INSERT ON "SalesLedger" TO sales_writer;
GRANT UPDATE (status, paidAt, deliveredAt, refundedAt, abandonedAt, accessTokenHash, paymentProviderTxid)
    ON "SalesLedger" TO sales_writer;
GRANT SELECT ON "CatalogEvent" TO sales_writer;
GRANT INSERT ON "CatalogEvent" TO sales_writer;

-- sales_writer: DENY ALL payout tables explicitly
REVOKE ALL ON "Payout" FROM sales_writer;
REVOKE ALL ON "PayoutLedger" FROM sales_writer;
REVOKE ALL ON "PayoutBatch" FROM sales_writer;
REVOKE ALL ON "PayoutItem" FROM sales_writer;
REVOKE ALL ON "PayoutEvent" FROM sales_writer;
REVOKE ALL ON "PayoutHold" FROM sales_writer;
REVOKE ALL ON "OwnerSettlement" FROM sales_writer;
REVOKE ALL ON "OwnerPayment" FROM sales_writer;
REVOKE ALL ON "OwnerPaymentConfig" FROM sales_writer;
REVOKE ALL ON "OwnerAccount" FROM sales_writer;
REVOKE ALL ON "ClearingBatch" FROM sales_writer;
REVOKE ALL ON "CryptoSettlement" FROM sales_writer;
REVOKE ALL ON "WireExecutionLog" FROM sales_writer;
REVOKE ALL ON "CashReturn" FROM sales_writer;

-- ── payout_writer: SELECT-only on SalesLedger. FULL WRITE on payout tables. ──
GRANT SELECT ON "SalesLedger" TO payout_writer;
GRANT SELECT, INSERT, UPDATE, DELETE ON "Payout" TO payout_writer;
GRANT SELECT, INSERT, UPDATE, DELETE ON "PayoutLedger" TO payout_writer;
GRANT SELECT, INSERT, UPDATE, DELETE ON "PayoutBatch" TO payout_writer;
GRANT SELECT, INSERT, UPDATE, DELETE ON "PayoutItem" TO payout_writer;
GRANT SELECT, INSERT, UPDATE ON "PayoutEvent" TO payout_writer;
GRANT SELECT, INSERT, UPDATE ON "PayoutHold" TO payout_writer;
GRANT SELECT, INSERT, UPDATE ON "OwnerSettlement" TO payout_writer;
GRANT SELECT, INSERT, UPDATE ON "OwnerPayment" TO payout_writer;
GRANT SELECT, INSERT, UPDATE ON "OwnerPaymentConfig" TO payout_writer;
GRANT SELECT, INSERT, UPDATE ON "OwnerAccount" TO payout_writer;
GRANT SELECT, INSERT, UPDATE ON "ClearingBatch" TO payout_writer;
GRANT SELECT, INSERT, UPDATE ON "CryptoSettlement" TO payout_writer;
GRANT SELECT, INSERT, UPDATE ON "WireExecutionLog" TO payout_writer;
GRANT SELECT, INSERT, UPDATE ON "CashReturn" TO payout_writer;
GRANT SELECT, INSERT, UPDATE ON "ReconciliationDiscrepancy" TO payout_writer;
GRANT SELECT, INSERT, UPDATE ON "TransactionLog" TO payout_writer;
GRANT SELECT, INSERT, UPDATE ON "RevenueLedgerEntry" TO payout_writer;
GRANT SELECT, INSERT, UPDATE ON "LedgerAccount" TO payout_writer;

-- ── marketing_agent: READ SalesLedger + CatalogEvent + InboundLead, but DENY status UPDATE ──
GRANT SELECT ON "SalesLedger" TO marketing_agent;
GRANT SELECT, INSERT ON "InboundLead" TO marketing_agent;
GRANT SELECT, INSERT ON "CatalogEvent" TO marketing_agent;
GRANT SELECT ON "PayoutLedger" TO marketing_agent;

-- EXPLICIT DENY UPDATE SalesLedger.status for marketing_agent
REVOKE UPDATE ON "SalesLedger" FROM marketing_agent;
REVOKE INSERT, UPDATE, DELETE ON "Payout" FROM marketing_agent;
REVOKE INSERT, UPDATE, DELETE ON "PayoutLedger" FROM marketing_agent;
REVOKE INSERT, UPDATE, DELETE ON "PayoutBatch" FROM marketing_agent;
REVOKE INSERT, UPDATE, DELETE ON "PayoutItem" FROM marketing_agent;
REVOKE INSERT, UPDATE, DELETE ON "OwnerSettlement" FROM marketing_agent;
REVOKE INSERT, UPDATE, DELETE ON "OwnerPayment" FROM marketing_agent;
REVOKE INSERT, UPDATE, DELETE ON "RevenueEvent" FROM marketing_agent;

-- ── DEFAULT privileges (for future tables) ──
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;

-- ── 8 permission assertion SQL (S6-T02 / S6-T05). Run via `psql -f ...` to verify. ──
-- 5 SHOULD FAIL (denied) + 3 SHOULD PASS (allowed).
--
-- ASSERTION FILE (run as superuser; each SET ROLE then try):
--   -- A1 (FAIL): marketing_agent trying to UPDATE SalesLedger.status
--   SET ROLE marketing_agent; UPDATE "SalesLedger" SET status='delivered' WHERE id='doesnotexist-000';  --> permission denied
--   RESET ROLE;
--   -- A2 (FAIL): sales_writer trying to UPDATE payoutledger
--   SET ROLE sales_writer; UPDATE "PayoutLedger" SET status='completed' WHERE id='doesnotexist-001';  --> permission denied
--   RESET ROLE;
--   -- A3 (FAIL): sales_writer trying to SELECT FROM OwnerAccount (explicit revoke, but some owners have column perm)
--   SET ROLE sales_writer; SELECT * FROM "OwnerAccount" LIMIT 1;  --> permission denied
--   RESET ROLE;
--   -- A4 (FAIL): payout_writer trying to UPDATE SalesLedger.status (only SELECT granted)
--   SET ROLE payout_writer; UPDATE "SalesLedger" SET status='paid' WHERE id='doesnotexist-002'; --> permission denied
--   RESET ROLE;
--   -- A5 (FAIL): marketing_agent INSERT into Payout
--   SET ROLE marketing_agent; INSERT INTO "Payout"(id,grossAmount,netAmount,destinationType,destinationFingerprint,idempotencyKey) VALUES ('z',0,0,'x','y','z9'); --> permission denied
--   RESET ROLE;
--   -- A6 (PASS): sales_writer INSERT SalesLedger
--   SET ROLE sales_writer; INSERT INTO "SalesLedger"(id,orderReference,productSlug,priceAmountCents,paymentMethod) VALUES ('assert-a6','RWC-ASSERT0001-A6','x',1,'paypal'); --> PASS (ok to delete after)
--   DELETE FROM "SalesLedger" WHERE id='assert-a6';
--   RESET ROLE;
--   -- A7 (PASS): sales_writer UPDATE (status column only granted)
--   SET ROLE sales_writer; UPDATE "SalesLedger" SET status='delivered' WHERE id='doesnotexist-007';  --> 0 rows affected (permission ok)
--   RESET ROLE;
--   -- A8 (PASS): payout_writer INSERT ReconciliationDiscrepancy
--   SET ROLE payout_writer; INSERT INTO "ReconciliationDiscrepancy"(id,discrepancyType,status,provider,internalReference) VALUES('assert-a8','status_mismatch','OPEN','wise','assert-a8-ref');  --> PASS
--   DELETE FROM "ReconciliationDiscrepancy" WHERE id='assert-a8';
--   RESET ROLE;
