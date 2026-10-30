import { PrismaClient } from '@prisma/client'
import { installTruthGuards } from './strict-enforcement/truth-guards'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  __prismaAdapter: unknown | undefined
  __prismaAdapterUrl: string | undefined
  __seedRestoreAttempted: boolean | undefined
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

/**
 * Continuity safeguard: restore supply-chain data from JSON backup on first
 * empty-DB access. Runs once per process lifetime (idempotent via flag).
 * Safe to call from anywhere; no-op if data already exists or backup missing.
 *
 * If tables are missing (fresh DB), runs `prisma db push` first to create them.
 */
export async function ensureDataContinuity(): Promise<void> {
  if (globalForPrisma.__seedRestoreAttempted) return
  globalForPrisma.__seedRestoreAttempted = true

  try {
    let count = 0
    try {
      count = await db.procurementItem.count()
    } catch (schemaErr) {
      // Tables missing → push schema first
      console.log('[continuity] Schema missing, pushing schema...')
      const { execSync } = await import('node:child_process')
      try {
        execSync('npx prisma db push --schema=prisma/schema.prisma --accept-data-loss', {
          stdio: 'pipe',
          timeout: 30_000,
          cwd: process.cwd(),
        })
        console.log('[continuity] Schema pushed')
        count = await db.procurementItem.count()
      } catch (pushErr) {
        console.warn('[continuity] schema push failed:', pushErr instanceof Error ? pushErr.message.slice(0, 100) : String(pushErr))
        return
      }
    }

    if (count > 0) {
      console.log(`[continuity] DB already has ${count} procurement items — no restore needed`)
      return
    }

    // Try JSON backup (works in any environment)
    const backupPath = join(process.cwd(), 'scripts', 'data', 'seed-backup.json')
    if (existsSync(backupPath)) {
      console.log('[continuity] DB empty — restoring from JSON backup...')
      const backup = JSON.parse(readFileSync(backupPath, 'utf8'))
      const MODELS = ['procurementItem', 'shipment', 'ownerPayment', 'ownerPaymentConfig'] as const
      let created = 0
      for (const model of MODELS) {
        const rows = backup[model] || []
        for (const row of rows) {
          try {
            const existing = await (db as any)[model].findUnique({ where: { id: row.id } })
            if (existing) continue
            await (db as any)[model].create({ data: row })
            created++
          } catch { /* skip duplicates / schema mismatches */ }
        }
      }
      if (created > 0) {
        console.log(`[continuity] ✅ Restored ${created} rows from JSON backup`)
      }
    } else {
      console.warn('[continuity] No JSON backup found at', backupPath)
    }
  } catch (e) {
    console.warn('[continuity] restore failed:', e instanceof Error ? e.message : String(e))
  }
}
