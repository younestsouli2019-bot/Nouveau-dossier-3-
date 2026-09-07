/**
 * DYNAMIC ENGINE — logless deadlock scraping at the GitHub Actions
 * CONTROL-PLANE level, plus the repair + circuit-breaker loop.
 *
 * Why the control plane: these deadlocks are killed BEFORE a runner is
 * provisioned, so in-code monitoring (Datadog / New Relic / OTel) sees
 * nothing. The signature is only visible via the Actions REST API:
 *
 *   Metric / Signature        | Deadlock          | Healthy run
 *   --------------------------+-------------------+----------------------
 *   runner id assignment      | null              | string (e.g. 10342)
 *   delta (completed-created) | <= 0 seconds      | > 2 seconds
 *   step breakdown count     | 0                 | >= 1
 *   log availability         | 404 / unavailable | 200 / streamable
 */

import { analyzeWorkflow, fixWorkflow, type WorkflowOffense } from './workflow-sanitize';

export interface DeadlockCandidate {
  runId: number;
  name: string;
  workflowPath: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface DeadlockVerdict extends DeadlockCandidate {
  reason: string;
}

export interface ScanContext {
  repo: string; // "owner/repo"
  token: string;
  fetchImpl?: typeof fetch;
  lookbackFailures?: number; // default 30
  verifyLogs404?: boolean; // default true
}

interface GhJob {
  id: number;
  runner_id: number | null;
  steps?: unknown[];
}

interface GhRun {
  id: number;
  name: string;
  path: string | null;
  created_at: string;
  completed_at: string | null;
}

async function gh(
  ctx: ScanContext,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const doFetch = ctx.fetchImpl ?? fetch;
  return doFetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${ctx.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'devops-self-healing',
      ...(init?.headers ?? {}),
    },
  });
}

/** Dynamic engine: scrape recent failures for the logless-deadlock signature. */
export async function scanDeadlocks(ctx: ScanContext): Promise<DeadlockVerdict[]> {
  const f = ctx.fetchImpl ?? fetch;
  const perPage = Math.min(Math.max(ctx.lookbackFailures ?? 30, 1), 100);

  const runsRes = await gh(ctx, `/repos/${ctx.repo}/actions/runs?per_page=${perPage}&status=failure`);
  if (!runsRes.ok) throw new Error(`runs query failed: ${runsRes.status}`);
  const runs = ((await runsRes.json()) as { workflow_runs: GhRun[] }).workflow_runs;

  const verdicts: DeadlockVerdict[] = [];
  for (const run of runs) {
    // Signature (a) + (b): never started a runner AND delta <= 0s.
    if (!run.completed_at) continue;
    const deltaMs = Date.parse(run.completed_at) - Date.parse(run.created_at);
    if (deltaMs > 0) continue; // a real run took measurable wall time

    // Signature (c): jobs with no steps and no runner assignment.
    const jobsRes = await gh(ctx, `/repos/${ctx.repo}/actions/runs/${run.id}/jobs?per_page=50`);
    if (!jobsRes.ok) continue;
    const jobs = ((await jobsRes.json()) as { jobs: GhJob[] }).jobs;
    if (jobs.length === 0) continue;
    if (!jobs.every((j) => j.runner_id === null && (j.steps?.length ?? 0) === 0)) continue;

    // Signature (d): logs unavailable (404).
    if (ctx.verifyLogs404 !== false) {
      let anyLogReachable = false;
      for (const j of jobs) {
        const logsRes = await gh(ctx, `/repos/${ctx.repo}/actions/jobs/${j.id}/logs`);
        // consume body to avoid socket stalls
        void logsRes.body?.cancel?.();
        if (logsRes.ok) anyLogReachable = true;
      }
      if (anyLogReachable) continue;
    }

    verdicts.push({
      runId: run.id,
      name: run.name,
      workflowPath: run.path,
      createdAt: run.created_at,
      completedAt: run.completed_at,
      reason:
        'logless deadlock: no runner provisioned, delta<=0s, 0 steps, logs 404',
    });
  }
  return verdicts;
}

/** Active repairman: strip duplicate child concurrency from the deadlocked workflow file. */
export function repairWorkflowFile(file: string, text: string): {
  changed: boolean;
  text: string;
  offenses: WorkflowOffense[];
} {
  const offenses = analyzeWorkflow(file, text);
  if (offenses.length === 0) {
    return { changed: false, text, offenses };
  }
  const r = fixWorkflow(text);
  return { changed: true, text: r.text, offenses: r.fixed };
}

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

export interface BreakerState {
  consecutiveTriggers: number;
  lastTriggerAt: string | null;
  tripped: boolean;
}

export const DEFAULT_STATE: BreakerState = {
  consecutiveTriggers: 0,
  lastTriggerAt: null,
  tripped: false,
};

export const BREAKER_THRESHOLD = 3;

/** Advance the breaker after a scan. Returns the new state and whether it JUST tripped. */
export function advanceBreaker(
  state: BreakerState,
  triggered: boolean,
  threshold: number = BREAKER_THRESHOLD
): { state: BreakerState; trippedNow: boolean } {
  if (!triggered) {
    return {
      state: { consecutiveTriggers: 0, lastTriggerAt: state.lastTriggerAt, tripped: false },
      trippedNow: false,
    };
  }
  const consecutive = state.consecutiveTriggers + 1;
  const tripped = consecutive > threshold;
  return {
    state: {
      consecutiveTriggers: consecutive,
      lastTriggerAt: new Date().toISOString(),
      tripped,
    },
    trippedNow: tripped && !state.tripped,
  };
}

/** Emergency-channel alert when the breaker trips (engine-level malfunction). */
export async function alertEmergencyChannel(
  webhookUrl: string,
  payload: { repo: string; consecutiveTriggers: number; lastRuns: DeadlockVerdict[] },
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  try {
    const res = await fetchImpl(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `🚨 DEVOPS SELF-HEALING CIRCUIT BREAKER TRIPPED — ${payload.repo}: ` +
          `${payload.consecutiveTriggers} consecutive deadlock-repair cycles. ` +
          `Engine-level malfunction suspected. Recent: ` +
          payload.lastRuns.map((r) => `#${r.runId} (${r.name})`).join(', '),
        repo: payload.repo,
        consecutiveTriggers: payload.consecutiveTriggers,
        runs: payload.lastRuns,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
