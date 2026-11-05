/**
 * Single-flight lease.
 *
 * Two strategies, in order:
 *  1. Postgres: an advisory xact lock protects the claim race, and an
 *     AutoPilotRun row with status 'running' is the durable lease. A stale
 *     row (no heartbeat within TTL) can be taken over.
 *  2. File: atomic create of .orchestrator/lease.json for local/CLI runs.
 *
 * If neither is available the caller must refuse to run — two reconcilers
 * mutating state concurrently is worse than no reconciler.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const LEASE_TTL_MS = 90 * 60 * 1000;
const LOCK_KEY = 'swarm_orchestrator_lease';
const FILE_PATH = path.join(process.cwd(), '.orchestrator', 'lease.json');

export interface Lease {
  id: string;
  strategy: 'db' | 'file';
  heartbeat: (phase: string) => Promise<void>;
  finish: (record: unknown) => Promise<void>;
  release: () => Promise<void>;
}

function meta(details: string | null): Record<string, unknown> {
  try { return details ? JSON.parse(details) : {}; } catch { return {}; }
}

export function leaseIsStale(heartbeatAt: unknown, now = Date.now(), ttl = LEASE_TTL_MS): boolean {
  const t = typeof heartbeatAt === 'string' ? Date.parse(heartbeatAt) : NaN;
  return !Number.isFinite(t) || now - t > ttl;
}

export async function acquireLease(trigger: string): Promise<Lease | null> {
  // --- 1. Postgres lease -------------------------------------------------
  // hashtext() is Postgres-only; selecting the strategy explicitly avoids a
  // noisy Prisma error under the local SQLite datasource.
  const isPostgres = /^postgres(ql)?:\/\//.test(process.env.DATABASE_URL || '');
  if (isPostgres) try {
    const { db } = await import('@/lib/db');
    const claimed = await db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ got: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtext(${LOCK_KEY})) AS got`;
      if (!rows?.[0]?.got) return null;
      const active = await tx.autoPilotRun.findFirst({
        where: { status: 'running' },
        orderBy: { createdAt: 'desc' },
      });
      if (active) {
        const m = meta(active.details);
        if (!leaseIsStale(m.heartbeatAt)) return null;
        await tx.autoPilotRun.update({
          where: { id: active.id },
          data: { status: 'stale', details: JSON.stringify({ ...m, supersededAt: new Date().toISOString() }) },
        });
      }
      return tx.autoPilotRun.create({
        data: {
          trigger,
          phase: 'TEST',
          status: 'running',
          details: JSON.stringify({ heartbeatAt: new Date().toISOString() }),
        },
      });
    });
    if (!claimed) return null;
    const id = claimed.id;
    return {
      id,
      strategy: 'db',
      async heartbeat(phase) {
        await db.autoPilotRun.update({
          where: { id },
          data: { phase, details: JSON.stringify({ heartbeatAt: new Date().toISOString(), phase }) },
        });
      },
      async finish(record) {
        const r = record as { status?: string; durationMs?: number; steps?: unknown; checks?: unknown };
        await db.autoPilotRun.update({
          where: { id },
          data: {
            status: r.status ?? 'unknown',
            durationMs: r.durationMs ?? 0,
            details: JSON.stringify({ heartbeatAt: new Date().toISOString(), record }),
          },
        });
      },
      async release() { /* row status is the lease; finish() ends it */ },
    };
  } catch {
    // DB unavailable — fall through to the file lease
  }

  // --- 2. File lease -----------------------------------------------------
  try {
    await fs.mkdir(path.dirname(FILE_PATH), { recursive: true });
    let current: { id: string; heartbeatAt: string } | null = null;
    try { current = JSON.parse(await fs.readFile(FILE_PATH, 'utf8')); } catch { current = null; }
    if (current && !leaseIsStale(current.heartbeatAt)) return null;
    const lease = { id: randomUUID(), heartbeatAt: new Date().toISOString() };
    await fs.writeFile(FILE_PATH, JSON.stringify(lease), { flag: 'w' });
    return {
      id: lease.id,
      strategy: 'file',
      async heartbeat() {
        await fs.writeFile(FILE_PATH, JSON.stringify({ id: lease.id, heartbeatAt: new Date().toISOString() }));
      },
      async finish(record) {
        const r = record as { status?: string };
        await fs.writeFile(FILE_PATH, JSON.stringify({ id: lease.id, heartbeatAt: new Date().toISOString(), finished: r.status ?? 'unknown' }));
      },
      async release() { await fs.rm(FILE_PATH, { force: true }); },
    };
  } catch {
    return null;
  }
}
