import { describe, it, expect, vi, afterEach } from 'vitest';
import { runAuth } from '@/app/api/maintenance/run/route';
import { notifyIfUnhealthy } from '@/lib/orchestrator/notify';
import type { RunRecord } from '@/lib/orchestrator/types';

const base: RunRecord = {
  id: 'run-1', trigger: 'test', status: 'degraded',
  startedAt: new Date().toISOString(), steps: {},
  checks: [{ name: 'database', status: 'degraded', required: true }], notes: [],
};

afterEach(() => {
  delete process.env.ORCHESTRATOR_ALERT_WEBHOOK;
  vi.unstubAllGlobals();
});

describe('runAuth', () => {
  it('refuses when no token is configured', () => {
    expect(runAuth('Bearer x', {})).toBe(503);
  });
  it('rejects a wrong token', () => {
    expect(runAuth('Bearer wrong', { run: 'secret' })).toBe(401);
  });
  it('rejects a missing header', () => {
    expect(runAuth(null, { cron: 'cron-secret' })).toBe(401);
  });
  it('accepts the cron token', () => {
    expect(runAuth('Bearer cron-secret', { cron: 'cron-secret' })).toBe(200);
  });
});

describe('notifyIfUnhealthy', () => {
  it('does nothing without a webhook', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    expect(await notifyIfUnhealthy(base)).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
  it('does not alert on a healthy run', async () => {
    process.env.ORCHESTRATOR_ALERT_WEBHOOK = 'https://hooks.example/x';
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    expect(await notifyIfUnhealthy({ ...base, status: 'ok' })).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
  it('alerts on a degraded run and includes the failing check', async () => {
    process.env.ORCHESTRATOR_ALERT_WEBHOOK = 'https://hooks.example/x';
    const f = vi.fn().mockResolvedValue(new Response('ok'));
    vi.stubGlobal('fetch', f);
    expect(await notifyIfUnhealthy(base)).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(body.text).toContain('DEGRADED');
    expect(body.text).toContain('database=degraded');
  });
});
