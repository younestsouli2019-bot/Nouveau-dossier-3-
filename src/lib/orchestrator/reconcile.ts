/** Real reconciliation checks. Nothing here fabricates a healthy result. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { CheckResult } from './types';

const LEDGER = path.join(process.cwd(), 'data', 'out', 'course-orders.ndjson');

export async function checkDatabase(): Promise<CheckResult> {
  if (!process.env.DATABASE_URL) return { name: 'database', status: 'unknown', detail: 'DATABASE_URL unset', required: true };
  try {
    const { db } = await import('@/lib/db');
    await db.$queryRaw`SELECT 1`;
    return { name: 'database', status: 'ok', required: true };
  } catch (e) {
    return { name: 'database', status: 'unknown', detail: (e as Error).message.slice(0, 160), required: true };
  }
}

export async function checkMigrations(): Promise<CheckResult> {
  try {
    const dir = path.join(process.cwd(), 'prisma', 'migrations');
    const local = (await fs.readdir(dir, { withFileTypes: true }))
      .filter((d) => d.isDirectory()).map((d) => d.name).sort();
    if (!local.length) return { name: 'migrations', status: 'skipped', detail: 'no local migrations' };
    if (!process.env.DATABASE_URL) return { name: 'migrations', status: 'unknown', detail: 'DATABASE_URL unset', required: true };
    const { db } = await import('@/lib/db');
    const rows = await db.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    const applied = new Set(rows.map((r) => r.migration_name));
    const drift = local.filter((m) => !applied.has(m));
    if (drift.length) return { name: 'migrations', status: 'degraded', detail: `unapplied: ${drift.slice(0, 5).join(', ')}`, required: true };
    return { name: 'migrations', status: 'ok', detail: `${applied.size} applied`, required: true };
  } catch (e) {
    return { name: 'migrations', status: 'unknown', detail: (e as Error).message.slice(0, 160), required: true };
  }
}

export function countPendingDeliveries(raw: string): number {
  let pending = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as { delivery?: string };
      if (r.delivery && r.delivery !== 'SENT') pending += 1;
    } catch { /* skip malformed line — never invent a count */ }
  }
  return pending;
}

export async function checkPendingDeliveries(): Promise<CheckResult> {
  try {
    const raw = await fs.readFile(LEDGER, 'utf8');
    const pending = countPendingDeliveries(raw);
    return pending === 0
      ? { name: 'pending-deliveries', status: 'ok' }
      : { name: 'pending-deliveries', status: 'degraded', detail: `${pending} paid order(s) awaiting delivery` };
  } catch {
    return { name: 'pending-deliveries', status: 'skipped', detail: 'ledger not present' };
  }
}

export async function checkRuntime(): Promise<CheckResult> {
  const url = process.env.RUNTIME_HEALTH_URL;
  if (!url) return { name: 'runtime', status: 'skipped', detail: 'RUNTIME_HEALTH_URL unset' };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(t);
    return res.ok
      ? { name: 'runtime', status: 'ok', detail: `${res.status}` }
      : { name: 'runtime', status: 'degraded', detail: `HTTP ${res.status}`, required: true };
  } catch (e) {
    return { name: 'runtime', status: 'degraded', detail: (e as Error).message.slice(0, 160), required: true };
  }
}

export async function checkLastSuccess(intervalMs: number): Promise<CheckResult> {
  try {
    const { db } = await import('@/lib/db');
    const last = await db.autoPilotRun.findFirst({
      where: { status: { in: ['ok', 'degraded'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (!last) return { name: 'freshness', status: 'unknown', detail: 'no completed run on record', required: true };
    const age = Date.now() - last.createdAt.getTime();
    return age > intervalMs * 2
      ? { name: 'freshness', status: 'degraded', detail: `last run ${Math.round(age / 60000)}m ago (interval ${Math.round(intervalMs / 60000)}m)`, required: true }
      : { name: 'freshness', status: 'ok', detail: `${Math.round(age / 60000)}m ago`, required: true };
  } catch (e) {
    return { name: 'freshness', status: 'unknown', detail: (e as Error).message.slice(0, 160), required: true };
  }
}

export async function runChecks(intervalMs: number): Promise<CheckResult[]> {
  return [await checkDatabase(), await checkMigrations(), await checkPendingDeliveries(), await checkRuntime(), await checkLastSuccess(intervalMs)];
}
