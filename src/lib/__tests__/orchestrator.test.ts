import { describe, it, expect } from 'vitest';
import { deriveStatus } from '../orchestrator/run';
import { leaseIsStale, LEASE_TTL_MS } from '../orchestrator/lease';
import { countPendingDeliveries } from '../orchestrator/reconcile';
import { checkStatusAuth } from '@/app/api/maintenance/status/route';

describe('deriveStatus', () => {
  it('treats a required unknown as unknown, never ok', () => {
    expect(deriveStatus([{ name: 'db', status: 'ok' }, { name: 'mig', status: 'unknown', required: true }])).toBe('unknown');
  });
  it('degrades on any degraded check', () => {
    expect(deriveStatus([{ name: 'db', status: 'ok' }, { name: 'pending', status: 'degraded' }])).toBe('degraded');
  });
  it('an all-skipped run is unknown, not ok', () => {
    expect(deriveStatus([{ name: 'a', status: 'skipped' }, { name: 'b', status: 'skipped' }])).toBe('unknown');
  });
  it('ok with a non-required skip', () => {
    expect(deriveStatus([{ name: 'db', status: 'ok' }, { name: 'runtime', status: 'skipped' }])).toBe('ok');
  });
});

describe('leaseIsStale', () => {
  it('recent heartbeat is live', () => {
    expect(leaseIsStale(new Date().toISOString())).toBe(false);
  });
  it('old heartbeat is stale', () => {
    expect(leaseIsStale(new Date(Date.now() - LEASE_TTL_MS - 1000).toISOString())).toBe(true);
  });
  it('missing/invalid heartbeat is stale (fail-closed)', () => {
    expect(leaseIsStale(undefined)).toBe(true);
    expect(leaseIsStale('not-a-date')).toBe(true);
  });
});

describe('pending delivery counting', () => {
  it('counts only rows with a non-SENT delivery', () => {
    const raw = [
      JSON.stringify({ delivery: 'SENT', slug: 'a' }),
      JSON.stringify({ delivery: 'PENDING', slug: 'b' }),
      JSON.stringify({ slug: 'c' }),
      '{malformed',
      '',
    ].join('\n');
    expect(countPendingDeliveries(raw)).toBe(1);
  });
});

describe('status endpoint auth', () => {
  it('refuses when the token is not configured', () => {
    expect(checkStatusAuth('Bearer x', undefined)).toBe(503);
  });
  it('rejects a wrong or missing header', () => {
    expect(checkStatusAuth(null, 'secret')).toBe(401);
    expect(checkStatusAuth('Bearer wrong', 'secret')).toBe(401);
  });
  it('accepts the exact bearer token', () => {
    expect(checkStatusAuth('Bearer secret', 'secret')).toBe(200);
  });
});
