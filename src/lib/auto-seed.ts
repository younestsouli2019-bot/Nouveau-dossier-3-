/**
 * Auto-seed worker — runs at app startup.
 *
 * Ensures the database is always populated with the 55-item supply chain
 * dataset after every container restart / sandbox recycle / fresh deploy.
 * Idempotent: skips if data already exists.
 *
 * Triggered from src/lib/db.ts after the Prisma client is created.
 */

import { db } from '@/lib/db'
import { seedProcurement } from '@/lib/procurement/seed-data'

const REQUIRED_PROCUREMENT_COUNT = 1
const SEED_LOCK_TIMEOUT_MS = 30_000

let seedingPromise: Promise<{ created: number; skipped: number }> | null = null
let lastCheck = 0
let lastResult: { count: number; ts: number } | null = null

export async function ensureSeeded(): Promise<{ created: number; skipped: number; already: number }> {
  // Cache the check for 60s to avoid hammering the DB on every request
  const now = Date.now()
  if (lastResult && now - lastResult.ts < 60_000) {
    return { created: 0, skipped: 0, already: lastResult.count }
  }

  try {
    const count = await db.procurementItem.count()
    lastResult = { count, ts: now }

    if (count >= REQUIRED_PROCUREMENT_COUNT) {
      return { created: 0, skipped: 0, already: count }
    }

    // Seed in-progress? Wait for it.
    if (seedingPromise) {
      const r = await seedingPromise
      return { created: r.created, skipped: r.skipped, already: 0 }
    }

    // Start seeding
    seedingPromise = seedProcurement(db).finally(() => {
      // Clear lock after timeout (in case it hung)
      setTimeout(() => { seedingPromise = null }, SEED_LOCK_TIMEOUT_MS)
    })

    const r = await seedingPromise
    seedingPromise = null
    lastResult = { count: r.created + r.skipped, ts: Date.now() }
    return { created: r.created, skipped: r.skipped, already: 0 }
  } catch (e) {
    console.error('[auto-seed] failed:', e instanceof Error ? e.message : String(e))
    return { created: 0, skipped: 0, already: 0 }
  }
}

/**
 * Background seed — fire and forget. Safe to call on every request.
 * Runs ensureSeeded() but never blocks the response.
 */
export function autoSeedBackground(): void {
  void ensureSeeded().catch(() => { /* swallow — already logged inside */ })
}
