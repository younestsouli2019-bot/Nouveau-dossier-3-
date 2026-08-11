// ——— Swarm Collective Memory ———
// Long-term memory that lets the swarm UNDERSTAND errors, LEARN which
// remedies actually work, and SELF-CORRECT by re-applying proven ones.
//
//   rememberIncident()  -> de-duplicates errors by fingerprint (code +
//                          component + normalized message) and bumps
//                          occurrence counts so recurring problems surface.
//   recordRemedy()      -> accumulates outcome history per (code, remedy);
//                          success resolves the incident, failure keeps it
//                          open so the swarm knows it has NOT learned yet.
//   recommendRemedy()   -> returns the most effective proven remedy for a
//                          code (>= MIN_ATTEMPTS observations required).
//   applyLearnedRemedy()-> executes a proven remedy when confidence is high
//                          enough — this is the self-correction loop.
//   getMemoryStatus()   -> observability for dashboards / status routes.
//
// Every function degrades gracefully when the tables have not been migrated
// yet (returns neutral values) so the agents keep running.

import { db } from '@/lib/db'
import { sha256 } from '@/lib/strict-enforcement/crypto-utils'

export type SwarmSeverity = 'info' | 'warning' | 'critical'
export type RemedyOutcome = 'success' | 'failure' | 'noop'

export interface RememberInput {
  code: string
  severity: SwarmSeverity
  component: string
  message: string
  context?: Record<string, unknown>
}

export interface RemedyRecord {
  remedy: string
  outcome: RemedyOutcome
  durationMs?: number
  context?: Record<string, unknown>
}

// A remedy must be observed at least this many times before it is trusted.
const MIN_ATTEMPTS = 2
// Success ratio above which a remedy is considered "proven".
const PROVEN_SUCCESS_RATE = 0.66

function normalizeMessage(message: string): string {
  return message.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function fingerprintError(input: Pick<RememberInput, 'code' | 'component' | 'message'>): string {
  return sha256(
    JSON.stringify({
      code: input.code,
      component: input.component,
      message: normalizeMessage(input.message),
    }),
  )
}

/**
 * Remember (or re-surface) an incident. Deduplicated by fingerprint:
 * recurring occurrences increment the count instead of creating new rows.
 */
export async function rememberIncident(input: RememberInput): Promise<{
  incident: { id: string; fingerprint: string; status: string; occurrenceCount: number }
  deduped: boolean
}> {
  const fingerprint = fingerprintError(input)
  const existing = await db.swarmIncident.findUnique({ where: { fingerprint } })
  if (existing) {
    const updated = await db.swarmIncident.update({
      where: { id: existing.id },
      data: { occurrenceCount: { increment: 1 }, lastSeenAt: new Date(), status: 'open' },
    })
    return {
      incident: { id: updated.id, fingerprint: updated.fingerprint, status: updated.status, occurrenceCount: updated.occurrenceCount },
      deduped: true,
    }
  }
  const created = await db.swarmIncident.create({
    data: {
      fingerprint,
      code: input.code,
      severity: input.severity,
      component: input.component,
      message: input.message,
      status: 'open',
      context: input.context ? JSON.stringify(input.context) : null,
    },
  })
  return {
    incident: { id: created.id, fingerprint: created.fingerprint, status: created.status, occurrenceCount: created.occurrenceCount },
    deduped: false,
  }
}

/**
 * Record an attempt to fix an incident. Learning happens here: on success the
 * incident is resolved; on failure it stays open (the swarm has NOT learned).
 */
export async function recordRemedy(
  input: RememberInput,
  attempt: RemedyRecord,
): Promise<{
  attempt: { id: string; outcome: RemedyOutcome }
  effectiveness: { attempts: number; successes: number; successRate: number }
} | null> {
  const fingerprint = fingerprintError(input)
  const incident = await db.swarmIncident.findUnique({ where: { fingerprint } })
  if (!incident) return null

  const created = await db.remedyAttempt.create({
    data: {
      incidentId: incident.id,
      remedy: attempt.remedy,
      outcome: attempt.outcome,
      durationMs: attempt.durationMs ?? 0,
      context: attempt.context ? JSON.stringify(attempt.context) : null,
    },
  })

  if (attempt.outcome === 'success') {
    await db.swarmIncident.update({
      where: { id: incident.id },
      data: { status: 'resolved', resolution: `resolved by remedy "${attempt.remedy}"` },
    })
  }

  const [attempts, successes] = await Promise.all([
    db.remedyAttempt.count({
      where: { incident: { code: input.code }, remedy: attempt.remedy },
    }),
    db.remedyAttempt.count({
      where: { incident: { code: input.code }, remedy: attempt.remedy, outcome: 'success' },
    }),
  ])
  return {
    attempt: { id: created.id, outcome: created.outcome as RemedyOutcome },
    effectiveness: { attempts, successes, successRate: attempts > 0 ? successes / attempts : 0 },
  }
}

/**
 * Best proven remedy for a code, or null when the swarm has not learned one.
 */
export async function recommendRemedy(code: string): Promise<{
  remedy: string
  attempts: number
  successes: number
  successRate: number
} | null> {
  const incidents = await db.swarmIncident.findMany({ where: { code }, select: { id: true } })
  const ids = incidents.map((i) => i.id)
  if (ids.length === 0) return null

  const rows = await db.remedyAttempt.findMany({ where: { incidentId: { in: ids } } })
  const byRemedy = new Map<string, { attempts: number; successes: number }>()
  for (const row of rows) {
    const cur = byRemedy.get(row.remedy) ?? { attempts: 0, successes: 0 }
    cur.attempts += 1
    if (row.outcome === 'success') cur.successes += 1
    byRemedy.set(row.remedy, cur)
  }

  let best: { remedy: string; attempts: number; successes: number; successRate: number } | null = null
  for (const [remedy, stats] of byRemedy) {
    if (stats.attempts < MIN_ATTEMPTS) continue
    const successRate = stats.successes / stats.attempts
    if (successRate < PROVEN_SUCCESS_RATE) continue
    if (!best || successRate > best.successRate || (successRate === best.successRate && stats.attempts > best.attempts)) {
      best = { remedy, attempts: stats.attempts, successes: stats.successes, successRate }
    }
  }
  return best
}

/**
 * SELF-CORRECTION: when the swarm has learned a proven remedy for a code,
 * re-apply it via `execute` and record the outcome for further learning.
 * Returns whether a remedy was applied.
 */
export async function applyLearnedRemedy(
  input: RememberInput,
  execute: (remedy: string) => Promise<RemedyOutcome>,
): Promise<{ applied: boolean; reason: string; successRate?: number }> {
  const learned = await recommendRemedy(input.code)
  if (!learned) {
    return { applied: false, reason: `no proven remedy learned for ${input.code}` }
  }
  const fingerprint = fingerprintError(input)
  const openIncident = await db.swarmIncident.findFirst({
    where: { fingerprint, status: { in: ['open', 'acknowledged', 'learned'] } },
  })
  if (!openIncident) {
    return { applied: false, reason: `${input.code} not currently open — nothing to correct` }
  }
  const startedAt = Date.now()
  const outcome = await execute(learned.remedy)
  await recordRemedy(input, {
    remedy: learned.remedy,
    outcome,
    durationMs: Date.now() - startedAt,
    context: { appliedFromMemory: true },
  })
  return { applied: true, reason: `applied learned remedy "${learned.remedy}"`, successRate: learned.successRate }
}

export async function getMemoryStatus() {
  try {
    const [incidents, resolved, open, occurrences, attempts, attemptRows, codes] = await Promise.all([
      db.swarmIncident.count(),
      db.swarmIncident.count({ where: { status: 'resolved' } }),
      db.swarmIncident.count({ where: { status: { in: ['open', 'acknowledged', 'learned'] } } }),
      db.swarmIncident.aggregate({ _sum: { occurrenceCount: true } }),
      db.remedyAttempt.count(),
      db.remedyAttempt.findMany({ take: 20, orderBy: { createdAt: 'desc' }, include: { incident: { select: { code: true, component: true } } } }),
      db.swarmIncident.groupBy({ by: ['code'], _count: { _all: true }, _max: { lastSeenAt: true }, orderBy: { _count: { code: 'desc' } } }),
    ])

    const topCodes = codes.map((c) => ({
      code: c.code,
      occurrences: c._count._all,
      lastSeenAt: c._max.lastSeenAt?.toISOString() ?? null,
    }))

    return {
      incidents: { total: incidents, open, resolved },
      occurrences: occurrences._sum.occurrenceCount ?? 0,
      topCodes,
      recentAttempts: attemptRows.map((a) => ({
        id: a.id,
        code: a.incident.code,
        component: a.incident.component,
        remedy: a.remedy,
        outcome: a.outcome,
        createdAt: a.createdAt.toISOString(),
      })),
    }
  } catch {
    return {
      incidents: { total: 0, open: 0, resolved: 0 },
      occurrences: 0,
      topCodes: [],
      recentAttempts: [],
    }
  }
}
