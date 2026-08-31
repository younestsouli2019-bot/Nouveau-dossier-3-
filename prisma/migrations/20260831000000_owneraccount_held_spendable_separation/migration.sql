-- OwnerAccount HELD -> SPENDABLE separation (fixes "funds settled to nothing / never released").
-- Adds heldBalance / spendableBalance / spendableLastReleasedAt so the financial
-- supervisor can authorize dispatch ONLY from spendableBalance (fail-closed: never
-- from heldBalance). Neon-safe: idempotent IF NOT EXISTS via DO block (Postgres).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'OwnerAccount' AND column_name = 'heldBalance') THEN
    ALTER TABLE "OwnerAccount" ADD COLUMN "heldBalance" DOUBLE PRECISION NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'OwnerAccount' AND column_name = 'spendableBalance') THEN
    ALTER TABLE "OwnerAccount" ADD COLUMN "spendableBalance" DOUBLE PRECISION NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'OwnerAccount' AND column_name = 'spendableLastReleasedAt') THEN
    ALTER TABLE "OwnerAccount" ADD COLUMN "spendableLastReleasedAt" TIMESTAMP(3);
  END IF;
END $$;
