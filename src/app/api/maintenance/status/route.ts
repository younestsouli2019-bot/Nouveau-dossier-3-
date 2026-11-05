/**
 * GET /api/maintenance/status
 *
 * Protected telemetry read. There is no wildcard CORS: this endpoint reports
 * operational state and must not be anonymously scrapeable.
 *
 * Fail-closed: without MAINTENANCE_STATUS_TOKEN the route refuses (503)
 * rather than exposing status. A DB read failure reports 'unknown', never
 * 'healthy'.
 */
import { NextResponse } from 'next/server';
import { runSnapshot } from '@/lib/orchestrator/snapshot';

export function checkStatusAuth(header: string | null, token: string | undefined): number {
  if (!token) return 503;
  if (!header || header !== `Bearer ${token}`) return 401;
  return 200;
}

export const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;

export async function GET(request: Request) {
  const token = process.env.MAINTENANCE_STATUS_TOKEN;
  const code = checkStatusAuth(request.headers.get('authorization'), token);
  if (code === 503) {
    return NextResponse.json(
      { error: 'status_endpoint_not_configured', detail: 'Set MAINTENANCE_STATUS_TOKEN to enable this endpoint.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  if (code === 401) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }

  const intervalMs = Number(process.env.ORCHESTRATOR_INTERVAL_MS || DEFAULT_INTERVAL_MS);

  // O(1) path: the in-process snapshot is the freshest view of a running pass.
  const snapshot = runSnapshot.load();
  if (snapshot.seq > 0) {
    const ageMs = Date.now() - Date.parse(snapshot.updatedAt);
    return NextResponse.json(
      {
        status: snapshot.status === 'ok' ? 'fresh' : 'stale',
        fresh: snapshot.status === 'ok' && ageMs <= intervalMs * 2,
        source: 'memory',
        intervalMs,
        snapshot,
        lastRunAgeMs: ageMs,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const { db } = await import('@/lib/db');
    const runs = await db.autoPilotRun.findMany({ orderBy: { createdAt: 'desc' }, take: 5 });
    const last = runs[0] ?? null;
    const lastCompleted = runs.find((r) => r.status === 'ok' || r.status === 'degraded') ?? null;
    const ageMs = lastCompleted ? Date.now() - lastCompleted.createdAt.getTime() : null;
    const fresh = ageMs !== null && ageMs <= intervalMs * 2;

    return NextResponse.json(
      {
        status: fresh ? 'fresh' : 'stale',
        fresh,
        intervalMs,
        lastRunAgeMs: ageMs,
        runs: runs.map((r) => ({ id: r.id, trigger: r.trigger, status: r.status, phase: r.phase, at: r.createdAt })),
        last: last ? { id: last.id, status: last.status, trigger: last.trigger } : null,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return NextResponse.json(
      { status: 'unknown', fresh: false, detail: `state store unreachable: ${(e as Error).message.slice(0, 120)}` },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
