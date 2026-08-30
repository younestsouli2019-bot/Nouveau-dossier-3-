import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e: any) {
      const msg = String((e?.message) || e || '');
      if (msg.includes('reach database server') || msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT')) { await sleep(4000); continue; }
      throw e;
    }
  }
  throw new Error('Neon unreachable after retries');
}

// 20260830000100 — fraud-guard PO fields on ProcurementItem (deliveryCity, expectedMinWeightKg)
async function migrationFraudFields() {
  await withRetry(() => prisma.$executeRawUnsafe(`
    ALTER TABLE "ProcurementItem" ADD COLUMN IF NOT EXISTS "deliveryCity" TEXT;
  `));
  await withRetry(() => prisma.$executeRawUnsafe(`
    ALTER TABLE "ProcurementItem" ADD COLUMN IF NOT EXISTS "expectedMinWeightKg" DOUBLE PRECISION;
  `));
  console.log('migration 20260830000100 fraud-guard fields: applied/verified');
}

// 20260830000200 — CRBT CashReturn ledger (COD retour de cash)
async function migrationCashReturn() {
  await withRetry(() => prisma.$executeRawUnsafe(`
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
  `));
  await withRetry(() => prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "CashReturn_shipmentId_key" ON "CashReturn"("shipmentId");
  `));
  console.log('migration 20260830000200 CRBT CashReturn ledger: applied/verified');
}

async function main() {
  await migrationFraudFields();
  await migrationCashReturn();

  // Verify
  const cols = await withRetry(() => prisma.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'ProcurementItem' AND column_name IN ('deliveryCity','expectedMinWeightKg');
  `));
  const coins = await withRetry(() => prisma.$queryRawUnsafe(`
    SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_name = 'CashReturn';
  `));
  console.log('ProcurementItem fraud-guard columns:', ((cols as Array<{ column_name: string }>) || []).map((c) => c.column_name).join(', ') || 'NONE');
  console.log('CashReturn column count:', (coins as any[])[0].n);
  console.log('ALL MIGRATIONS OK');
}

main().catch(e => { console.log('\nERR', String((e?.message && e.stack) || e).slice(0, 3000)); process.exit(1); });