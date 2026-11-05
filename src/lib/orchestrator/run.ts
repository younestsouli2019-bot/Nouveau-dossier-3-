/** One bounded reconciliation pass. Safe to call from a cron or a CLI. */
import { acquireLease } from './lease';
import { runChecks } from './reconcile';
import { notifyIfUnhealthy } from './notify';
import type { CheckResult, OrchestratorOptions, RunRecord, RunStatus, StepName } from './types';

export const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** A run with only skipped checks is NOT ok — nothing was verified. */
export function deriveStatus(checks: CheckResult[]): RunStatus {
  if (checks.some((c) => c.required && c.status === 'unknown')) return 'unknown';
  if (checks.some((c) => c.status === 'degraded')) return 'degraded';
  if (checks.every((c) => c.status === 'skipped')) return 'unknown';
  return 'ok';
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try { return await Promise.race([p, timeout]); } finally { clearTimeout(timer!); }
}

export async function executePass(opts: OrchestratorOptions): Promise<RunRecord> {
  const startedAt = new Date().toISOString();
  const base: RunRecord = { id: 'unclaimed', trigger: opts.trigger, status: 'skipped', startedAt, steps: {}, checks: [], notes: [] };

  const lease = await acquireLease(opts.trigger);
  if (!lease) {
    return { ...base, notes: ['another run holds the lease — skipped, not failed'] };
  }

  const steps: RunRecord['steps'] = { TEST: 'running' };
  let checks: CheckResult[] = [];
  let status: RunStatus = 'unknown';
  const notes: string[] = [`lease=${lease.strategy}`];
  let hb: NodeJS.Timeout | undefined;

  try {
    // Keep the lease warm while probes run; a slow probe must not look dead.
    hb = setInterval(() => { void lease.heartbeat('RECONCILE').catch(() => {}); }, 30_000);
    checks = await withTimeout(runChecks(opts.intervalMs ?? DEFAULT_INTERVAL_MS), 60_000, 'reconcile');
    steps.TEST = checks.find((c) => c.name === 'database')?.status === 'ok' ? 'ok' : 'unknown';
    steps.RECONCILE = 'ok';
    await lease.heartbeat('RECONCILE');

    // CLEANUP + DEDUP are report-only unless --apply. Nothing destructive runs unproven.
    steps.CLEANUP = 'skipped';
    steps.DEDUP = 'skipped';
    notes.push(opts.apply ? 'apply requested — destructive steps not enabled in this build' : 'read-only pass');

    status = deriveStatus(checks);
  } catch (e) {
    status = 'failed';
    notes.push(`fatal: ${(e as Error).message.slice(0, 200)}`);
  } finally {
    if (hb) clearInterval(hb);
  }

  const record: RunRecord = {
    ...base,
    status,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - Date.parse(startedAt),
    steps,
    checks,
    notes,
  };
  try { await lease.finish(record); } finally { await lease.release(); }
  await notifyIfUnhealthy(record);
  return record;
}
