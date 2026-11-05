# Orchestration Primitives — Team Guide

How the background reconciliation matrix works, what each primitive
guarantees, and how to operate it. Architecture rationale lives in
`docs/ORCHESTRATOR-ARCHITECTURE.md`; upgrade governance in
`governance/PROTOCOL.md`.

## Mental model

There is no forever-loop in production. A scheduler invokes **one bounded
pass**, the pass verifies real state, records a durable result, and exits.
A long-lived ticker exists only for VM/container hosts. This is deliberate:
a daemon inside a serverless function is a process that dies silently and
reports nothing.

```
scheduler (cron/HTTP)
        |
        v
  acquire lease  --(held)--> skipped (exit 3)
        |
        v
  TEST -> RECONCILE (3 probes in parallel, 15s each)
        |
        v
  status: ok | degraded | unknown | failed
        |
        +--> durable run row + snapshot + alert (if not ok)
```

## Quickstart

```bash
npm run orchestrator:run            # one pass, human output
npm run orchestrator:run -- --json  # machine-readable
npm run governance:check -- governance/proposals/<id>.json
```

Exit codes: `0` ok, `1` degraded, `2` unknown/failed, `3` skipped (lease held).

Environment:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | durable lease + run ledger; absent -> checks are `unknown` |
| `RUNTIME_HEALTH_URL` | optional live probe of the deployed app |
| `ORCHESTRATOR_INTERVAL_MS` | expected cadence, default 6h (drives staleness) |
| `ORCHESTRATOR_ALERT_WEBHOOK` | Slack-compatible alert on non-ok runs |
| `ORCHESTRATOR_RUN_TOKEN` / `CRON_SECRET` | auth for `POST/GET /api/maintenance/run` |
| `MAINTENANCE_STATUS_TOKEN` | auth for `GET /api/maintenance/status` |

## SnapshotStore — `src/lib/orchestrator/snapshot.ts`

Replacement for Go's `atomic.Pointer[TelemetryPayload]`.

```ts
import { runSnapshot, publishSnapshot } from '@/lib/orchestrator/snapshot';

runSnapshot.load();                       // O(1), frozen, never partial
await publishSnapshot({ step: 'RECONCILE' });
```

Guarantees:
- Reads return one immutable object; no reader ever sees half an update.
- Updates are serialized through an internal promise queue, so two writers
  cannot lose each other's fields (the classic Load/modify/Store race).
- `seq` increments per update; use it to detect missed transitions.

Do not mutate a loaded snapshot. Spread it into a new object instead.

## mapWithConcurrency / withTimeout — `src/lib/orchestrator/concurrency.ts`

Replacement for `errgroup.SetLimit` + `context.WithTimeout`.

```ts
const settled = await mapWithConcurrency(tasks, 3, (t) => t.run(), 15_000);
// settled[i].status === 'fulfilled' | 'rejected'  — input order preserved
```

Guarantees:
- At most `limit` tasks in flight.
- Every task has its own deadline; a hang becomes a `rejected` result and the
  pass continues. It never stalls the matrix.
- No unhandled rejections.

Caveat: JavaScript cannot preempt a promise. A timed-out task keeps running
in the background unless it internally observes an `AbortSignal`. Keep probe
bodies short and cancellation-aware.

## startDaemon — `src/lib/orchestrator/daemon.ts`

Replacement for `time.NewTicker` + `WaitGroup`. Long-lived hosts only.

```ts
import { startDaemon } from '@/lib/orchestrator/daemon';

const handle = startDaemon({
  intervalMs: 6 * 60 * 60 * 1000,
  jitterMs: 5 * 60 * 1000,
  run: () => executePass({ trigger: 'daemon' }),
  onError: (e) => console.error(e),
});
// handle.stop() awaits the in-flight pass before resolving
```

Guarantees: jittered schedule (no thundering herd), a skipped tick if the
previous pass is still running, and cooperative shutdown via `stop()` or an
`AbortSignal`.

Do not start this inside a serverless handler. Use the cron endpoint.

## Lease — `src/lib/orchestrator/lease.ts`

Single-flight guarantee across processes and invocations.

- **Postgres:** `pg_try_advisory_xact_lock` settles the claim race, then an
  `AutoPilotRun` row with a heartbeat becomes the durable lease.
- **No database:** a file lease is used (local CLI only).
- **Neither available:** the pass refuses; status is `skipped`, never `ok`.
- A lease whose heartbeat is older than 90 minutes can be taken over.
- `heartbeat()` every 30s during probes so a slow check is not mistaken for
  a dead runner.

Rules: always `finish(record)` then `release()`. A released lease must carry
a terminal status, otherwise the next run reports a stale takeover.

## Runner semantics — `src/lib/orchestrator/run.ts`

| Status | Meaning | Operator action |
|---|---|---|
| `ok` | every required check green | none |
| `degraded` | a dependency failed but the runner worked | investigate named check |
| `unknown` | truth could not be established | fix the probe/dependency |
| `failed` | the runner itself threw | inspect stack, fix code |
| `skipped` | another run held the lease | none; check for a stuck run |

Invariants:
- A required `unknown` forces the run to `unknown`.
- All-checks-skipped is `unknown`, never `ok`.
- `degraded` means a dependency; `failed` means the runner.
- Destructive cleanup/dedup stay report-only until explicitly enabled.

## Endpoints

`POST` or `GET /api/maintenance/run` — executes one pass. Bearer token from
`ORCHESTRATOR_RUN_TOKEN` or `CRON_SECRET`. 503 if neither is configured; 401 on
mismatch. Vercel Cron should call this with `Authorization: Bearer $CRON_SECRET`.

`GET /api/maintenance/status` — snapshot-first (O(1)), database fallback.
Requires `MAINTENANCE_STATUS_TOKEN`; 503 unset, 401 mismatch. Returns
`Cache-Control: no-store` and no wildcard CORS.

## Upgrade timelock — `src/lib/governance/timelock.ts`

Proposals gate risky changes before deploy. Full design:
`governance/PROTOCOL.md`. Minimums: config 24h, workflow 48h, schema 72h,
money-path 7d; 14-day expiry; distinct approvers only; proposer excluded;
approvals bound to `sha256(diff)` so any post-review edit voids quorum.
Emergency is rollback-only: 1h delay, 2x quorum, `rollbackOf` required.

## Operational runbook

1. `status = unknown`, reason `DATABASE_URL unset` → the runner cannot verify
   anything. Set the environment; do not read this as "healthy".
2. `status = degraded` on `pending-deliveries` → paid orders without delivery.
   Check the receipt provider, then replay from the ledger.
3. `status = skipped` repeatedly → a previous pass may be stuck. Inspect the
   `AutoPilotRun` row with `status = running` and its `details.heartbeatAt`.
4. No runs at all for more than 2x the interval → the scheduler is broken.
   This is the failure the alert webhook exists to catch.
5. `runtime` check `skipped` → `RUNTIME_HEALTH_URL` unset; the app is not
   being probed even if the matrix reports `ok` elsewhere.

## Testing

```bash
npx vitest run src/lib/__tests__/orchestrator-primitives.test.ts \
               src/lib/__tests__/orchestrator.test.ts \
               src/lib/__tests__/orchestrator-http.test.ts \
               src/lib/__tests__/timelock.test.ts
```

Current coverage: 34 tests across those four suites (381 in the repository).

| Suite | Covers |
|---|---|
| `orchestrator-primitives` | lost-update safety, concurrency limit, timeouts, daemon overlap/stop |
| `orchestrator` | status derivation, lease staleness/mutex, pending-delivery counting |
| `orchestrator-http` | auth matrix (503/401/200), alert suppression and payload |
| `timelock` | delay tiers, self-approval, diff mismatch, expiry, emergency rules |

## Anti-patterns

- Reporting `ok` when every check was skipped. Nothing verified is not health.
- Catching an error and writing `status: 'ok'` — map it to `unknown`.
- Long-running work inside the lease transaction; it holds a connection.
- Wildcard CORS or unauthenticated status reads.
- Mutating a snapshot in place; always produce a new object.
- Adding metric labels with slugs, transaction ids, or error strings
  (unbounded cardinality once Prometheus is enabled).
- Treating the timelock as advisory: it binds only when the deploy job runs
  `npm run governance:check`.
