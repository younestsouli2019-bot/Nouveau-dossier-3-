import { describe, it, expect } from 'vitest';
import { SnapshotStore } from '@/lib/orchestrator/snapshot';
import { mapWithConcurrency } from '@/lib/orchestrator/concurrency';
import { startDaemon } from '@/lib/orchestrator/daemon';

describe('SnapshotStore (atomic.Pointer semantics)', () => {
  it('serializes concurrent updates without losing any', async () => {
    const store = new SnapshotStore({ seq: 0, status: 'never' });
    await Promise.all(
      Array.from({ length: 50 }, () =>
        store.update((cur) => ({ ...cur, seq: cur.seq + 1 })),
      ),
    );
    expect(store.load().seq).toBe(50);
  });

  it('publishes a new frozen object on every update', async () => {
    const store = new SnapshotStore({ value: 1 });
    const before = store.load();
    await store.patch({ value: 2 });
    const after = store.load();
    expect(Object.isFrozen(after)).toBe(true);
    expect(before).not.toBe(after);
    expect(before.value).toBe(1);
    expect(after.value).toBe(2);
  });
});

describe('mapWithConcurrency (errgroup.SetLimit semantics)', () => {
  it('never exceeds the limit and preserves input order', async () => {
    let active = 0;
    let maxActive = 0;
    const results = await mapWithConcurrency(
      [30, 10, 20, 5, 15],
      2,
      async (ms) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, ms));
        active -= 1;
        return ms * 2;
      },
      1_000,
    );
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(results.map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual([60, 20, 40, 10, 30]);
  });

  it('turns a slow task into a rejection, not a hang', async () => {
    const [slow, fast] = await mapWithConcurrency(
      [1, 2],
      2,
      async (n) => {
        if (n === 1) await new Promise((r) => setTimeout(r, 200));
        return n;
      },
      30,
    );
    expect(slow.status).toBe('rejected');
    expect(fast.status).toBe('fulfilled');
  });
});

describe('startDaemon (ticker + WaitGroup semantics)', () => {
  it('never overlaps runs and stops cooperatively', async () => {
    let runs = 0;
    let active = 0;
    let maxActive = 0;
    let skips = 0;

    const handle = startDaemon({
      intervalMs: 5,
      run: async () => {
        runs += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 30));
        active -= 1;
      },
      onSkip: () => { skips += 1; },
    });

    await new Promise((r) => setTimeout(r, 120));
    await handle.stop();
    const finalRuns = runs;

    await new Promise((r) => setTimeout(r, 40));
    expect(runs).toBe(finalRuns);
    expect(maxActive).toBe(1);
    expect(skips).toBeGreaterThanOrEqual(0);
    expect(finalRuns).toBeGreaterThanOrEqual(1);
  });
});
