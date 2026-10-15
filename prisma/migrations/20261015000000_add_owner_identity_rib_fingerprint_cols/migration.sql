-- 2026-10-15 — OWNER identity + RIB fingerprint columns (release->main parity).
-- P5: OwnerAccount / OwnerPayment no longer store a raw RIB as source of truth;
--     the truth is ribFingerprintSha256 = sha256(rib) hex(64) (+ ribDisplayMasked
--     cache, "***last6" only — never the full RIB).
-- P6: PurchaseOrder records the VERIFIED operator identity (requireOpsAuth) in
--     createdBy / submittedBy instead of a literal "user".
-- Additive-only + idempotent (IF NOT EXISTS) so `prisma migrate deploy` against a
-- database already carrying these columns (out-of-band db push) is a safe no-op.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'PurchaseOrder' AND column_name = 'createdBy') THEN
    ALTER TABLE "PurchaseOrder" ADD COLUMN "createdBy" VARCHAR(64);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'PurchaseOrder' AND column_name = 'submittedBy') THEN
    ALTER TABLE "PurchaseOrder" ADD COLUMN "submittedBy" VARCHAR(64);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'OwnerAccount' AND column_name = 'ribFingerprintSha256') THEN
    ALTER TABLE "OwnerAccount" ADD COLUMN "ribFingerprintSha256" VARCHAR(64);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'OwnerPayment' AND column_name = 'ribFingerprintSha256') THEN
    ALTER TABLE "OwnerPayment" ADD COLUMN "ribFingerprintSha256" VARCHAR(64);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'OwnerPayment' AND column_name = 'ribDisplayMasked') THEN
    ALTER TABLE "OwnerPayment" ADD COLUMN "ribDisplayMasked" VARCHAR(24);
  END IF;
END $$;
