-- OwnerAccount Stripe Connect columns (fail-closed; guarded at gateway & missingCredentials layer)
-- Neon-safe: IF NOT EXISTS via DO block (Postgres)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'OwnerAccount' AND column_name = 'stripeConnectAccountId') THEN
    ALTER TABLE "OwnerAccount" ADD COLUMN "stripeConnectAccountId" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'OwnerAccount' AND column_name = 'stripeAccountType') THEN
    ALTER TABLE "OwnerAccount" ADD COLUMN "stripeAccountType" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'OwnerAccount' AND column_name = 'stripeCountry') THEN
    ALTER TABLE "OwnerAccount" ADD COLUMN "stripeCountry" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'OwnerAccount' AND column_name = 'stripeChargesEnabled') THEN
    ALTER TABLE "OwnerAccount" ADD COLUMN "stripeChargesEnabled" BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'OwnerAccount' AND column_name = 'stripePayoutsEnabled') THEN
    ALTER TABLE "OwnerAccount" ADD COLUMN "stripePayoutsEnabled" BOOLEAN DEFAULT false;
  END IF;
END $$;
