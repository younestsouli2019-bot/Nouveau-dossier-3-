-- 2026-08-30 — CRBT: COD cash-return status ledger (OWNER directive)
-- "gestion des statuts de retour de cash (CRBT)": Moroccan e-commerce COD carriers
-- (Amana / Forcelog / Chrono Diali / Cathedis / Aramex / Quick / Mylerz / ...) collect
-- cash at delivery and reverse it to the merchant/proxy on a cadence ("retour de fond
-- chaque 12h-24h" — Forcelog). This table is the status ledger for cash WE are owed
-- when a COD collect is used, or settled against the 3PL/COD-proxy balance.
-- Fail-closed: reaching settled/returned requires a REAL external proofRef.
CREATE TABLE IF NOT EXISTS "CashReturn" (
    "id"                TEXT      NOT NULL,
    "shipmentId"        TEXT,
    "procurementItemId" TEXT,
    "shipmentNumber"    TEXT,
    "itemName"          TEXT,
    "carrier"           TEXT,
    "trackingNumber"    TEXT,
    "status"            TEXT      NOT NULL DEFAULT 'cash_collected',
    "amountExpectedMAD" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amountCollectedMAD" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency"          TEXT      NOT NULL DEFAULT 'MAD',
    "collectionBranch"  TEXT,
    "destinationCity"   TEXT,
    "collectedAt"       TIMESTAMP(3),
    "reversedAt"        TIMESTAMP(3),
    "reconciledAt"      TIMESTAMP(3),
    "settledAt"         TIMESTAMP(3),
    "proofRef"          TEXT,
    "proofHash"         TEXT,
    "disputeReason"     TEXT,
    "notes"             TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CashReturn_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CashReturn_shipmentId_key" ON "CashReturn"("shipmentId");