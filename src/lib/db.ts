import { PrismaClient } from '@prisma/client'
import { installTruthGuards } from './strict-enforcement/truth-guards'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  // Prisma 7: driver adapter is mandatory. Auto-detect by DATABASE_URL scheme:
  //   - `file:`      → SQLite  (local dev / preview / Space-Z FC containers)
  //   - `postgres:`  → Postgres (production Neon / Supabase)
  const connectionString = process.env.DATABASE_URL || ''
  const isSqlite = connectionString.startsWith('file:')

  let adapter: unknown
  if (isSqlite) {
    // Dynamic import so the better-sqlite3 native module is only loaded when
    // actually needed (it's not installed in pure-Postgres environments).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3')
    const dbPath = connectionString.replace(/^file:/, '')
    adapter = new PrismaBetterSqlite3({ url: dbPath })
  } else {
    // Connection tuning params (connect_timeout, pool_timeout, etc.)
    // are passed via the connection string query params
    const sep = connectionString.includes('?') ? '&' : '?'
    const caps = 'connect_timeout=10&pool_timeout=15&statement_timeout=30000&application_name=supply-chain-swarm'
    const tunedUrl = connectionString ? `${connectionString}${sep}${caps}` : connectionString
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaPg } = require('@prisma/adapter-pg')
    adapter = new PrismaPg({ connectionString: tunedUrl })
  }

  const base = new PrismaClient({
    adapter: adapter as never,
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
