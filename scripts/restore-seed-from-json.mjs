#!/usr/bin/env node
/**
 * restore-seed-from-json.mjs
 *
 * Restores the supply-chain dataset from scripts/data/seed-backup.json
 * into the current database. Idempotent — skips records that already exist.
 *
 * Use after a sandbox recycle, fresh deploy, or DB wipe:
 *   node scripts/restore-seed-from-json.mjs
 *
 * Reads DATABASE_URL from .env automatically.
 */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// Load .env
try {
  const envFile = readFileSync(join(ROOT, '.env'), 'utf8')
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    const val = trimmed.slice(idx + 1).trim()
    if (!process.env[key]) process.env[key] = val
  }
} catch { /* no .env */ }

const BACKUP_PATH = join(ROOT, 'scripts', 'data', 'seed-backup.json')

if (!existsSync(BACKUP_PATH)) {
  console.error('✗ No seed backup found at', BACKUP_PATH)
  console.error('  Run the seed API first: curl -X POST -H "x-ops-secret: $OPS_API_SECRET" http://localhost:3000/api/supply-chain/seed')
  process.exit(1)
}

const { PrismaClient } = await import('@prisma/client')
const { PrismaLibSql } = await import('@prisma/adapter-libsql')

const url = process.env.DATABASE_URL || 'file:./db/custom.db'
const adapter = new PrismaLibSql({ url })
const prisma = new PrismaClient({ adapter })

const backup = JSON.parse(readFileSync(BACKUP_PATH, 'utf8'))

const MODELS = ['procurementItem', 'shipment', 'ownerPayment', 'ownerPaymentConfig']

let created = 0
let skipped = 0

for (const model of MODELS) {
  const rows = backup[model] || []
  if (!rows.length) {
    console.log(`  ${model}: 0 rows in backup`)
    continue
  }

  for (const row of rows) {
    try {
      // Skip if exists (by id)
      const existing = await prisma[model].findUnique({ where: { id: row.id } })
      if (existing) {
        skipped++
        continue
      }
      await prisma[model].create({ data: row })
      created++
    } catch (e) {
      console.warn(`  ⚠ ${model} ${row.id}: ${e.message.slice(0, 80)}`)
      skipped++
    }
  }
  console.log(`  ${model}: ${rows.length} rows processed`)
}

console.log(`\n✓ Restore complete: ${created} created, ${skipped} skipped`)
await prisma.$disconnect()
