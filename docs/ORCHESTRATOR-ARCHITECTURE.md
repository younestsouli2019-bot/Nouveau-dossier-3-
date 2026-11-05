# Background Orchestration Matrix — Architecture

Status: design + partial implementation (TS runner shipped in `be3f94f`).
Scope: bounded reconciliation, telemetry, single-flight, failure semantics.

## 1. Constraints that drive the design

1. **Serverless first.** The production runtime is Next.js on Vercel. An
   infinite `ticker` loop dies when the invocation ends, so the default mode is
   a *bounded pass*: one run per invocation, invoked by a scheduler.
2. **Long-lived is optional.** If the workload moves to a VM/container, the same
   pass runs inside a daemon loop. Nothing in the pass may assume it owns the
   process for more than its own duration.
3. **No fabricated health.** A dependency that cannot be read yields `UNKNOWN`.
   The system is never healthy by default, and "nothing checked" is `UNKNOWN`.
4. **One runner at a time.** Overlap is a correctness bug (double cleanup, double
   ledger writes), so single-flight is enforced before any work starts.

## 2. Component matrix

| Component | Responsibility | Failure behaviour |
|---|---|---|
| Trigger | cron, webhook, CLI | missed run -> freshness alert |
| Lease | single-flight claim + heartbeat | contention -> `skipped` (exit 3) |
| State machine | ordered stages | stage timeout -> `failed`, lease released |
| Probe set | real reads of each dependency | unreachable -> `unknown` |
| Snapshot | immutable telemetry for readers | never blocks writers |
| Run ledger | durable history | DB down -> run cannot claim (no silent run) |
| Status API | protected read of snapshot + freshness | token unset -> 503 |
| Alerting | absence + drift + degradation | alert on absence, not only on error |

## 3. Concurrency model (Go primitives, corrected)

### 3.1 Telemetry: single writer, immutable snapshots

The original snippet did Load-modify-Store from several call sites, which drops
fields under concurrency, and one updater wrote `InfrastructureDeg: 0`
unconditionally, erasing a live alert.

```go
type Snapshot struct {
    Running     bool
    Step        PipelineStep
    Degradation int
    Message     string
    Blueprint   string
    UpdatedAt   time.Time
}

type Store struct {
    mu sync.Mutex          // guards the read-modify-write
    v  atomic.Pointer[Snapshot]
}

func (s *Store) Update(fn func(Snapshot) Snapshot) {
    s.mu.Lock()
    defer s.mu.Unlock()
    cur := *s.v.Load()
    next := fn(cur)          // copy-on-write: readers keep the old pointer
    next.UpdatedAt = time.Now()
    s.v.Store(&next)
}

func (s *Store) Load() Snapshot { return *s.v.Load() } // allocation-free read
```

Rules:
- `Load()` is the only reader path; it never takes the mutex.
- All mutations go through `Update`, so no field can be silently reset.
- Never store a pointer to a struct that is still being mutated.

### 3.2 Probes: bounded fan-out with per-probe deadlines

```go
func runProbes(ctx context.Context, probes []Probe, limit int) []CheckResult {
    g, ctx := errgroup.WithContext(ctx)
    g.SetLimit(limit)                       // bounded concurrency
    out := make([]CheckResult, len(probes))
    for i, p := range probes {
        i, p := i, p
        g.Go(func() error {
            pctx, cancel := context.WithTimeout(ctx, p.Timeout)
            defer cancel()
            out[i] = p.Run(pctx)            // returns UNKNOWN, never panics
            return nil                      // failures are data, not errors
        })
    }
    _ = g.Wait()
    return out
}
```

`WaitGroup` is only appropriate when every goroutine must finish and no error
propagation is needed. For probe fan-out, `errgroup` with `SetLimit` gives
bounded concurrency and cancellation.

### 3.3 Daemon loop (long-lived mode only)

```go
func (o *Orchestrator) Run(ctx context.Context) {
    d := time.Duration(6*time.Hour) + jitter(15*time.Minute)
    t := time.NewTicker(d)
    defer t.Stop()
    for {
        if o.guard.CompareAndSwap(false, true) {   // overlap guard
            o.executePass(ctx)
            o.guard.Store(false)
        }
        select {
        case <-t.C:
        case <-ctx.Done():
            return
        }
    }
}
```

Shutdown uses `signal.NotifyContext`; every pass honours `ctx` so a deploy
does not leave a half-finished cleanup.

## 4. State machine

```
        claim lease
             |
           TEST  ---------- dependency unreachable --> UNKNOWN
             |
         RECONCILE ------ partial failure ----------> DEGRADED
             |
      +------+------+
      |             |
   CLEANUP        DEDUP        (report-only unless --apply)
      |             |
      +------+------+
             |
        finalize + release
       ok | degraded | unknown | failed
```

Invariants:
- `ok` requires every required check `ok`; any `unknown` required check -> run `unknown`.
- A run where all checks were `skipped` is `unknown`, not `ok`.
- `failed` means the runner itself broke; `degraded` means a dependency did.
- The lease is released on every exit path, including panic (defer).

## 5. Failure and recovery

| Event | Detection | Behaviour |
|---|---|---|
| Runner crash mid-pass | lease heartbeat older than TTL | next run takes over, records `stale` |
| Two schedulers fire | lease claim race (advisory xact lock) | second returns `skipped` |
| DB unreachable | claim fails | run does not start (never a silent pass) |
| Probe timeout | per-probe context | check `unknown`, run `unknown` |
| Migration drift | applied vs local migrations | check `degraded`, alert |
| Missed runs | `now - last_success > 2 x interval` | alert on absence |

## 6. Durability

Use the existing `AutoPilotRun` row as the lease and the ledger (no new table):

```
id, trigger, phase, status, details(JSON: heartbeatAt, steps, checks), createdAt
```

Claim protocol (Postgres):
1. `SELECT pg_try_advisory_xact_lock(hashtext('swarm_orchestrator_lease'))`.
2. Read the newest `status = 'running'` row.
3. If heartbeat is fresh, release and return `skipped`.
4. If stale past TTL, mark `stale` and claim.
5. Insert the new `running` row, commit (lock released, row is the lease).

SQLite/local uses a file lease; when neither is available the runner refuses to
start rather than risk overlap.

## 7. Security

- Status endpoint requires `Authorization: Bearer $MAINTENANCE_STATUS_TOKEN`;
  503 when unset, 401 on mismatch, `Cache-Control: no-store`.
- No wildcard CORS. Bind the daemon to a private interface behind the proxy.
- Run identifiers and error strings stay out of metric labels.

## 8. Migrations policy

Prisma owns DDL: `prisma migrate deploy` runs each migration in a transaction
and records checksums. The orchestrator **must not** run migrations inside its
loop.

If a non-transactional statement is unavoidable (`CREATE INDEX CONCURRENTLY`,
`VACUUM`), it is a separately reviewed migration with an explicit marker, run
outside the transaction, under the same advisory lock as deploys.

## 9. Observability

Start with absence alerting (cheap, catches the real failures):
- `orchestrator_last_success_timestamp_seconds` — alert if older than 2x interval.
- `orchestrator_schema_drift` — alert if > 0.
- `orchestrator_degradation_score` — gauge 0..100.

Add Prometheus when there is a live scrape target and an SLO to defend. Keep
cardinality bounded; never label by slug, transaction id, or error text.

## 10. Shared contract with the TypeScript runner

Both runners emit the same JSON and exit codes so either can take over:

```
RunRecord { id, trigger, status, startedAt, finishedAt, durationMs, steps, checks, notes }
exit 0 ok | 1 degraded | 2 unknown/failed | 3 skipped (lease held)
```

Implemented: `src/lib/orchestrator/*`, `scripts/orchestrator-run.ts`,
`GET /api/maintenance/status` (`be3f94f`).

## 11. Anti-patterns removed

| Original | Why it fails | Replacement |
|---|---|---|
| `fetchRemoteManifest` returns a literal | always "converges", hides drift | real fetch, error -> `unknown` |
| Load/modify/Store in several places | lost updates | single `Update` with mutex |
| `InfrastructureDeg: 0` on config swap | erases alerts | preserve fields |
| ticker with no overlap guard | concurrent passes | CAS guard + lease |
| `Access-Control-Allow-Origin: *` | anonymous telemetry | bearer token |
| in-memory only | restart forgets the run | durable row + heartbeat |

## 12. Rollout

1. Run the TS pass on a cron; verify absence alerting fires when disabled.
2. Enable `RUNTIME_HEALTH_URL` and migration drift checks in production.
3. Only then consider the Go daemon (VM/container) for higher-frequency probes.
4. Metrics last, once the semantics above are stable.

---

## Implementation map (TypeScript)

| Go primitive | TypeScript implementation | File |
|---|---|---|
| `atomic.Pointer[TelemetryPayload]` | `SnapshotStore` — frozen immutable snapshot, single reference swap | `src/lib/orchestrator/snapshot.ts` |
| `sync.RWMutex` write path | serialized promise-queue `update()` (no lost read-modify-write) | `snapshot.ts` |
| `context.WithTimeout` + `errgroup.SetLimit` | `mapWithConcurrency` — bounded workers, per-task deadline, ordered results | `concurrency.ts` |
| `sync.WaitGroup` + error channel | `PromiseSettledResult[]` — no unhandled rejections, failures become `unknown` checks | `concurrency.ts` |
| `time.NewTicker` + overlap guard | `startDaemon` — jitter, never overlaps, cooperative stop awaits in-flight | `daemon.ts` |
| HTTP telemetry handler | `/api/maintenance/status` — bearer auth, snapshot-first O(1), DB fallback | `src/app/api/maintenance/status/route.ts` |
| Durable state | `AutoPilotRun` lease row + `pg_try_advisory_xact_lock` + heartbeat | `lease.ts` |

Deliberate divergences: no unbounded goroutine per probe (bounded workers), no
reflection, and no in-process daemon in serverless mode — the scheduler invokes
one bounded pass instead.
