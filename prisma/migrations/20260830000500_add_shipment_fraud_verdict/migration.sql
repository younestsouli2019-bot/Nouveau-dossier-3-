-- 2026-08-30 — Shipment fraud-verdict persistence (manual review queue anchor)
-- Stores the LAST 3-point fraud-guard verdict per shipment so failed/hold
-- outcomes are queryable (GET /api/shipments/review-queue) instead of being
-- buried in an append-only notes string. Fail-closed verification itself is
-- unchanged: trackingVerified still flips ONLY on real delivered + VERIFIED_OK.
-- Idempotent: IF NOT EXISTS guards make re-runs safe.
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "lastFraudVerdict" TEXT;
ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "lastFraudVerdictAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Shipment_lastFraudVerdict_idx" ON "Shipment"("lastFraudVerdict");
