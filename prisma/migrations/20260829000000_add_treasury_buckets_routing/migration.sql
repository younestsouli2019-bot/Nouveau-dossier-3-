-- CreateTable: FundBucket — four treasury buckets:
--   sovereign_reserves · procurement_buffer · runtime_operations · salary_bucket.
-- Balances are monotonic (allocated/released/balance = allocated - released).
CREATE TABLE IF NOT EXISTS "FundBucket" (
    "code"            VARCHAR(64)  NOT NULL,
    "label"           VARCHAR(255) NOT NULL,
    "percentagePct"   DOUBLE PRECISION NOT NULL DEFAULT 0,
    "balance"         DOUBLE PRECISION NOT NULL DEFAULT 0,
    "allocated"       DOUBLE PRECISION NOT NULL DEFAULT 0,
    "released"        DOUBLE PRECISION NOT NULL DEFAULT 0,
    "note"            TEXT,
    "configHash"      VARCHAR(128),
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FundBucket_pkey" PRIMARY KEY ("code")
);

-- CreateTable: PayoutRoutingRule — treasury split engine.
-- Each rule matches a sourceType+sourceFilter and distributes NET settlement
-- across ownerAccountIds or FundBucket codes via destinationSplits JSONB.
CREATE TABLE IF NOT EXISTS "PayoutRoutingRule" (
    "id"                VARCHAR(36)  NOT NULL,
    "name"              VARCHAR(255) NOT NULL,
    "sourceType"        VARCHAR(64)  NOT NULL DEFAULT 'any',
    "sourceFilter"      JSONB,
    "destinationSplits" JSONB        NOT NULL,
    "platformFeePct"    DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalPct"          DOUBLE PRECISION NOT NULL DEFAULT 100,
    "priority"          INTEGER      NOT NULL DEFAULT 0,
    "cooldownMs"        BIGINT       NOT NULL DEFAULT 0,
    "isActive"          BOOLEAN      NOT NULL DEFAULT TRUE,
    "triggerCount"      INTEGER      NOT NULL DEFAULT 0,
    "lastTriggeredAt"   TIMESTAMP(3),
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutRoutingRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex — matches @@index([sourceType, isActive, priority]) in schema.prisma
CREATE INDEX IF NOT EXISTS "PayoutRoutingRule_sourceType_isActive_priority_idx"
    ON "PayoutRoutingRule" ("sourceType", "isActive", "priority" DESC);

-- Seed the four treasury buckets with default percentages.
-- Idempotent: rows only inserted if the code does not yet exist.
INSERT INTO "FundBucket" ("code", "label", "percentagePct", "balance", "allocated", "released", "note", "updatedAt")
VALUES
  ('sovereign_reserves', 'Sovereign Reserves',              30, 0, 0, 0, 'Long-term capital reserves / contingency fund',          CURRENT_TIMESTAMP),
  ('procurement_buffer', 'Owner Procurement Buffer',       10, 0, 0, 0, 'Funds reserved to pay owner-directed purchase orders', CURRENT_TIMESTAMP),
  ('runtime_operations', 'Runtime Operations',             20, 0, 0, 0, 'Swarm infrastructure allocation (owner-allowed %)',     CURRENT_TIMESTAMP),
  ('salary_bucket',      'Owner Salary Bucket',            40, 0, 0, 0, 'Owner salary allocation — Attijariwafa RIB 372 MAD',     CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- Seed the default routing rule that splits NET settlement across the four
-- treasury buckets (30/10/20/40, sum 100).  The settleAndPayout() code in
-- payout-routing.ts resolves this rule by priority=100 if no custom rule
-- matches.
INSERT INTO "PayoutRoutingRule"
  ("id", "name", "sourceType", "destinationSplits", "platformFeePct", "totalPct", "priority", "cooldownMs", "isActive", "triggerCount", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'Default Treasury Bucket Split (40/30/20/10)',
  'any',
  '[{"bucketCode":"sovereign_reserves","pct":30},{"bucketCode":"procurement_buffer","pct":10},{"bucketCode":"runtime_operations","pct":20},{"bucketCode":"salary_bucket","pct":40}]'::jsonb,
  0, 100, 100, 0, TRUE, 0,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;
