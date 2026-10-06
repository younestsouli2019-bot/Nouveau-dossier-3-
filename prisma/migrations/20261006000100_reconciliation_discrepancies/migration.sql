-- S5-T03: Reconciliation discrepancies table + enums + schema-level CHECK constraints
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'discrepancy_type_t') THEN
        CREATE TYPE discrepancy_type_t AS ENUM (
            'provider_tx_missing',
            'amount_mismatch',
            'status_mismatch',
            'duplicate_txid'
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'disc_status_t') THEN
        CREATE TYPE disc_status_t AS ENUM (
            'OPEN',
            'INVESTIGATING',
            'RESOLVED_CONFIRMED',
            'RESOLVED_WRITES_OFF',
            'CLOSED_FALSE_POSITIVE'
        );
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "ReconciliationDiscrepancy" (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    discrepancy_type discrepancy_type_t NOT NULL,
    status disc_status_t NOT NULL DEFAULT 'OPEN',
    provider TEXT NOT NULL,
    provider_txid TEXT,
    internal_reference TEXT NOT NULL,
    expected_amount_cents BIGINT,
    actual_amount_cents BIGINT,
    expected_status TEXT,
    actual_status TEXT,
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    resolution_notes TEXT,
    payload_snapshot JSONB,
    -- CHECK: resolution_notes >= 40 chars whenever status != 'OPEN'
    CONSTRAINT disc_resolution_notes_minlen CHECK (
        status = 'OPEN' OR (
            resolution_notes IS NOT NULL
            AND CHAR_LENGTH(TRIM(resolution_notes)) >= 40
        )
    )
);

CREATE INDEX IF NOT EXISTS recdisc_provider_status_idx
    ON "ReconciliationDiscrepancy"(provider, status);

CREATE INDEX IF NOT EXISTS recdisc_detected_at_idx
    ON "ReconciliationDiscrepancy"(detected_at);

CREATE UNIQUE INDEX IF NOT EXISTS recdisc_uniq_internal_ref_type
    ON "ReconciliationDiscrepancy"(internal_reference, discrepancy_type)
    WHERE status = 'OPEN';
