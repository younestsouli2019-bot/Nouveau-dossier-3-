-- 2026-08-30 — TRACKING FRAUD GUARD fields (OWNER directive, multi-factor post-extraction validation)
-- Geographic match + weight-variance threshold need two new expectations per ProcurementItem:
--   deliveryCity: the expected destination terminal/city/hub for this item (e.g. "Tanger",
--                 "Casablanca Had Soualem", "Rabat Medina"). The keyless scraper's parsed
--                 destination MUST match it before trackingVerified=true / payout release.
--   expectedMinWeightKg: the minimum real package weight for heavy goods. If the carrier page
--                 parses a weight far below this (e.g. buying a 5.0 kg box, carrier says 0.1 kg)
--                 → automatic payment hold (empty-box scam guard). Null = weight check skipped.
-- Idempotent: IF NOT EXISTS guards make re-runs safe.
ALTER TABLE "ProcurementItem" ADD COLUMN IF NOT EXISTS "deliveryCity" TEXT;
ALTER TABLE "ProcurementItem" ADD COLUMN IF NOT EXISTS "expectedMinWeightKg" DOUBLE PRECISION;