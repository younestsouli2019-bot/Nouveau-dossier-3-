import { PrismaClient } from '@prisma/client'
import { installTruthGuards } from './strict-enforcement/truth-guards'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  __prismaAdapter: unknown | undefined
  __prismaAdapterUrl: string | undefined
}

/**
 * Build (or return cached) driver adapter.
 *
 * Prisma 7: driver adapter is mandatory. Auto-detect by DATABASE_URL scheme:
 *   - `file:`      → libsql (pure JS, native-SQLite-compatible) — avoids the
 *                     better-sqlite3 native module crash with Turbopack HMR
 *                     (Statement::~Statement assertion failure)
 *   - `postgres:`  → PrismaPg (production Neon / Supabase)
 *
 * Cached in globalThis so HMR doesn't re-instantiate.
 */
function getAdapter(): unknown {
  const connectionString = process.env.DATABASE_URL || ''

  if (
    globalForPrisma.__prismaAdapter &&
    globalForPrisma.__prismaAdapterUrl === connectionString
  ) {
    return globalForPrisma.__prismaAdapter
  }

  const isSqlite = connectionString.startsWith('file:') || !connectionString
  let adapter: unknown

  if (isSqlite) {
    // Pure-JS adapter — no native module, no destructor assertion under HMR.
    // PrismaLibSql accepts { url } directly; no need for @libsql/client createClient.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaLibSql } = require('@prisma/adapter-libsql')
    const url = connectionString || 'file:./db/custom.db'
    adapter = new PrismaLibSql({ url })
  } else {
    const sep = connectionString.includes('?') ? '&' : '?'
    const caps = 'connect_timeout=10&pool_timeout=15&statement_timeout=30000&application_name=supply-chain-swarm'
    const tunedUrl = connectionString ? `${connectionString}${sep}${caps}` : connectionString
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaPg } = require('@prisma/adapter-pg')
    adapter = new PrismaPg({ connectionString: tunedUrl })
  }

  globalForPrisma.__prismaAdapter = adapter
  globalForPrisma.__prismaAdapterUrl = connectionString
  return adapter
}

function createPrismaClient() {
  const base = new PrismaClient({
    adapter: getAdapter() as never,
    log: process.env.DEBUG_PRISMA === '1' ? ['query', 'info', 'warn', 'error'] : ['warn', 'error'],
    transactionOptions: {
      maxWait: 8000,
      timeout: 15000,
      isolationLevel: 'ReadCommitted',
    },
  })

  return installTruthGuards(base)
}

export const db =
  globalForPrisma.prisma ??
  createPrismaClient()

export const prisma = db

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
