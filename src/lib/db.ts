import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { installTruthGuards } from './strict-enforcement/truth-guards'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  // Prisma 7: driver adapter is mandatory — no more datasourceUrl or
  // env-based connections. PrismaPg wraps the `pg` package and connects
  // using the DATABASE_URL environment variable.
  const connectionString = process.env.DATABASE_URL || ''

  // Connection tuning params (connect_timeout, pool_timeout, etc.)
  // are passed via the connection string query params
  const sep = connectionString.includes('?') ? '&' : '?'
  const caps = 'connect_timeout=10&pool_timeout=15&statement_timeout=30000&application_name=supply-chain-swarm'
  const tunedUrl = connectionString ? `${connectionString}${sep}${caps}` : connectionString

  const adapter = new PrismaPg({ connectionString: tunedUrl })

  const base = new PrismaClient({
    adapter,
    log: process.env.DEBUG_PRISMA === '1' ? ['query', 'info', 'warn', 'error'] : ['warn', 'error'],
    transactionOptions: {
      maxWait: 8000,
      timeout: 15000,
      isolationLevel: 'ReadCommitted',
    },
  })

  // Prisma 7: $extends returns a NEW extended client (the original is not
  // mutated) — always use the return value.
  return installTruthGuards(base)
}

export const db =
  globalForPrisma.prisma ??
  createPrismaClient()

export const prisma = db

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
