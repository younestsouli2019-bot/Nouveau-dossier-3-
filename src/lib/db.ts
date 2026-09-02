import { PrismaClient } from '@prisma/client'
import { installTruthGuards } from './strict-enforcement/truth-guards'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  // Prisma 7: datasourceUrl removed from constructor — connection URL
  // is now configured in prisma.config.ts. Connection tuning params
  // (connect_timeout, pool_timeout, statement_timeout) are also moved
  // to prisma.config.ts datasource.url.
  const client = new PrismaClient({
    log: process.env.DEBUG_PRISMA === '1' ? ['query', 'info', 'warn', 'error'] : ['warn', 'error'],
    transactionOptions: {
      maxWait: 8000,
      timeout: 15000,
      isolationLevel: 'ReadCommitted',
    },
  })

  installTruthGuards(client)

  return client
}

export const db =
  globalForPrisma.prisma ??
  createPrismaClient()

export const prisma = db

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
