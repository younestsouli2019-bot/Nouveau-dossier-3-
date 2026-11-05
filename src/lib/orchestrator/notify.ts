/**
 * Outbound alerting for unhealthy runs. Fail-soft: an alert that cannot be
 * delivered must never fail or roll back the pass that produced it.
 */
import type { RunRecord } from './types';

export async function notifyIfUnhealthy(record: RunRecord): Promise<boolean> {
  const url = process.env.ORCHESTRATOR_ALERT_WEBHOOK;
  if (!url || record.status === 'ok') return false;

  const failing = record.checks
    .filter((c) => c.status !== 'ok' && c.status !== 'skipped')
    .map((c) => `${c.name}=${c.status}`)
    .join(', ');

  const text = `[orchestrator] ${record.status.toUpperCase()} — ${failing || 'no detail'} (trigger=${record.trigger}, run=${record.id})`;

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(5000),
    });
    return true;
  } catch {
    return false;
  }
}
