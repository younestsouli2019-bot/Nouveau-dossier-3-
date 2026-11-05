/**
 * atomic.Pointer[TelemetryPayload] -> SnapshotStore.
 *
 * JS has no atomic pointer, but a single reference assignment is atomic under
 * the event loop. Reads are O(1) and never see a half-updated object because
 * every update publishes a NEW frozen object. Writes are serialized through a
 * promise queue (the RWMutex/CAS equivalent), so no update is lost.
 */
export interface RunSnapshot {
  seq: number;
  status: string;
  trigger?: string;
  step?: string;
  startedAt?: string;
  updatedAt: string;
  durationMs?: number;
  lastError?: string;
}

export class SnapshotStore<T extends object> {
  private current: Readonly<T>;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(initial: T) {
    this.current = Object.freeze({ ...initial });
  }

  /** O(1) read — the dashboard polling path. */
  load(): Readonly<T> {
    return this.current;
  }

  /** Serialized copy-on-write update. */
  update(fn: (cur: Readonly<T>) => T): Promise<Readonly<T>> {
    const next = this.queue.then(() => {
      const value = Object.freeze({ ...fn(this.current) });
      this.current = value;
      return value;
    });
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }

  patch(partial: Partial<T>): Promise<Readonly<T>> {
    return this.update((cur) => ({ ...cur, ...partial }));
  }
}

export const runSnapshot = new SnapshotStore<RunSnapshot>({
  seq: 0,
  status: 'never',
  updatedAt: new Date(0).toISOString(),
});

export async function publishSnapshot(partial: Partial<RunSnapshot>): Promise<void> {
  await runSnapshot.update((cur) => ({
    ...cur,
    ...partial,
    seq: cur.seq + 1,
    updatedAt: new Date().toISOString(),
  }));
}
