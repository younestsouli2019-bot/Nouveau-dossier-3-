/**
 * time.NewTicker + sync.WaitGroup -> startDaemon.
 *
 * Long-lived mode only (VM/container); serverless uses the bounded pass.
 * Jittered interval, no overlapping runs, cooperative stop that awaits the
 * in-flight pass.
 */
export interface DaemonOptions {
  intervalMs: number;
  jitterMs?: number;
  run: () => Promise<unknown>;
  onSkip?: (reason: 'in-flight') => void;
  onError?: (error: unknown) => void;
  signal?: AbortSignal;
}

export interface DaemonHandle {
  stop: () => Promise<void>;
  running: () => boolean;
}

export function startDaemon(opts: DaemonOptions): DaemonHandle {
  let stopped = false;
  let inFlight = false;
  let inFlightPromise: Promise<void> = Promise.resolve();
  let wake: (() => void) | null = null;

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      wake = () => { clearTimeout(timer); resolve(); };
    });

  async function loop(): Promise<void> {
    while (!stopped) {
      if (inFlight) {
        opts.onSkip?.('in-flight');
      } else {
        inFlight = true;
        inFlightPromise = (async () => {
          try {
            await opts.run();
          } catch (error) {
            opts.onError?.(error);
          } finally {
            inFlight = false;
          }
        })();
      }
      await inFlightPromise;
      if (stopped) break;
      await sleep(opts.intervalMs + Math.random() * (opts.jitterMs ?? 0));
    }
  }

  const done = loop();

  const stop = async (): Promise<void> => {
    stopped = true;
    wake?.();
    await done;
    await inFlightPromise;
  };

  opts.signal?.addEventListener('abort', () => { void stop(); }, { once: true });

  return { stop, running: () => inFlight };
}
