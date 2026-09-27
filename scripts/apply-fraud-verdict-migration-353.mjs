import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

function makeClient() {
  const connectionString = process.env.DATABASE_URL || ''
  const sep = connectionString.includes('?') ? '&' : '?'
  const caps = 'connect_timeout=10&pool_timeout=15&statement_timeout=30000&application_name=supply-chain-swarm'
  const tunedUrl = connectionString ? `${connectionString}${sep}${caps}` : connectionString
  const adapter = new PrismaPg({ connectionString: tunedUrl })
  return new PrismaClient({ adapter })
}

const db = makeClient()

const statements = [
  `ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "lastFraudVerdict" TEXT`,
  `ALTER TABLE "Shipment" ADD COLUMN IF NOT EXISTS "lastFraudVerdictAt" TIMESTAMP(3)`,
  `CREATE INDEX IF NOT EXISTS "Shipment_lastFraudVerdict_idx" ON "Shipment"("lastFraudVerdict")`,
]

;(async () => {
  for (const sql of statements) {
    try {
      await db.$executeRawUnsafe(sql)
      console.log('OK   ' + sql.slice(0, 70))
    } catch (e) {
      console.log('WARN ' + (e?.message ?? String(e)).slice(0, 120))
    }
  }
  await db.$disconnect()
  process.exit(0)
})().catch((e) => {
  console.error('FATAL:', e?.message ?? String(e))
  process.exit(1)
})
