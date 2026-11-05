/** Shared types for the bounded reconciliation orchestrator. */
export type StepName = 'TEST' | 'RECONCILE' | 'CLEANUP' | 'DEDUP';
export type StepState = 'pending' | 'running' | 'ok' | 'degraded' | 'unknown' | 'failed' | 'skipped';
export type CheckStatus = 'ok' | 'degraded' | 'unknown' | 'skipped';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail?: string;
  /** Required checks turn an `unknown` into a non-ok run. */
  required?: boolean;
}

export type RunStatus = 'running' | 'ok' | 'degraded' | 'unknown' | 'failed' | 'skipped';

export interface RunRecord {
  id: string;
  trigger: string;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  steps: Partial<Record<StepName, StepState>>;
  checks: CheckResult[];
  notes: string[];
}

export interface OrchestratorOptions {
  trigger: string;
  /** Destructive steps (cleanup/dedup) stay read-only unless this is true. */
  apply?: boolean;
  intervalMs?: number;
}
