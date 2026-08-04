# Multi-Machine Swarm Runbook

The swarm is designed to survive loss of any single machine. Work is
dispatched through a git-synced task queue: any machine can enqueue work,
any other machine pulls the repo, claims an atomic lease, runs the handler,
and commits the result back. No single box is authoritative.

## Concepts

- **Task** — a JSON file `<id>.task.json` with `type`, `title`, `payload`, `priority`.
- **Claim lease** — a directory `<id>.claim/claim.json`. Created with
  `fs.mkdirSync` which is atomic: only one worker can win a given task.
  Stale leases are released by `reap()` after `leaseMs` (default 15 min).
- **Result** — `<id>.done.json` written on success or failure, keeps full history.
- **Queue dir** — defaults to `data/swarm/tasks` (gitignored). For shared
  git-sync between machines, point `TASK_QUEUE_DIR` at a tracked directory
  such as `data/queue/tasks`.

## Components

| File | Purpose |
| --- | --- |
| `src/task-queue.mjs` | Atomic queue: `enqueue`, `claim`, `complete`, `fail`, `list`, `stats`, `reap`, `clear`; `runCommand`/`gitCommand` helpers. |
| `src/task-orchestrator.mjs` | Handler map (`run-tests`, `edu:*`, `swarm:supervisor`), `processOnce`, `runLoop` with `git pull --rebase`. |
| `src/task-queue-cli.mjs` | CLI: `enqueue`, `list`/`status`, `process`, `loop`, `reap`, `clear`. |
| `scripts/spawn-parallel-workers.mjs` | Spawns N `loop` workers (default 2), manifest at `data/swarm/workers/manifest.json`. |
| `src/autonomous-daemon.mjs` | Daemon tick can process the queue via `cfg.tasks.taskQueue`. |

## Single machine

```powershell
# enqueue a job
node src/task-queue-cli.mjs enqueue --type run-tests --title "nightly"

# process one job now
node src/task-queue-cli.mjs process --max 1

# run an infinite worker loop (claim -> run -> commit result -> pull again)
node src/task-queue-cli.mjs loop --interval 15000 --max 1 --worker box_a
```

## Parallel workers (one box, many processes)

```powershell
$env:PARALLEL_WORKERS = "2"
node scripts/spawn-parallel-workers.mjs
# manifest written to data/swarm/workers/manifest.json
# Ctrl-C/SIGTERM kills all children cleanly
```

## Multi-machine (shared queue over git)

Every machine works from its own clone of `origin/main`. The queue
directory must be a tracked path so tasks, claims and results are
exchanged through ordinary `git push`/`pull`.

```powershell
# on every worker machine
$env:TASK_QUEUE_DIR = "data/queue/tasks"
git config core.autocrlf false        # keep JSON lines stable across OS
git config core.quotepath false

# worker loop with pull-first synchronization
node src/task-queue-cli.mjs loop --interval 30000 --max 1 --worker box_b --pull true
```

The orchestrator's `gitPullOnce()` runs `git pull --rebase --no-verify`
before claiming each batch. Results are committed by the worker after each
successful run:

```powershell
# after completing work, sync results upstream
git add -A data/queue
git commit --no-verify -m "swarm: results from box_b"
git push --no-verify origin main
```

Enqueue from anywhere:

```powershell
node src/task-queue-cli.mjs enqueue --type edu:factory:preview --title "new course preview"
git add -A data/queue; git commit --no-verify -m "swarm: task enqueued"; git push --no-verify origin main
```

## Daemon integration

The autonomous daemon can drain the queue on its normal tick:

```json
{
  "tasks": { "taskQueue": true },
  "taskQueue": { "intervalMs": 60000, "maxPerTick": 1, "pull": true }
}
```

Equivalent env: `AUTONOMOUS_TASK_QUEUE=true`,
`AUTONOMOUS_TASK_QUEUE_INTERVAL_MS=60000`,
`AUTONOMOUS_TASK_QUEUE_MAX_PER_TICK=1`, `AUTONOMOUS_TASK_QUEUE_PULL=true`.
Task processing is skipped when `BASE44_OFFLINE`/offline mode is active.

## Doomsday recovery (machine lost)

1. On any surviving box: `git clone https://github.com/younestsouli2019-bot/Nouveau-dossier-3-.git`.
2. `npm ci` (or `npm install`), then `npm test` — expect 303 passing.
3. Re-enable live gating: confirm `SWARM_LIVE=true`, owner allowlists, PayPal creds.
4. Start workers: `node scripts/spawn-parallel-workers.mjs` (or daemon with `taskQueue:true`).
5. Any unclaimed tasks from the lost machine are reclaimed automatically once
   their lease expires (`reap`). Claim leases never block forever.

## Operational rules

- Never `git rm` a `<id>.done.json` — results are the audit trail.
- `git push --no-verify` is required (broken git-lfs hooks crash on this box).
- Never commit secrets (`.env*`, `CREDS.txt`, `.keys/` are ignored).
- Money-moving work (`createPayoutBatches`, PayPal submits, owner settlement)
  still requires `SWARM_LIVE=true` and the daemon live-mode invariant —
  the task queue handlers only run safe jobs (`run-tests`, `edu:*`).
