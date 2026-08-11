// ——— Agentic Core Types ———
// Self-Connector, Self-Tester, Self-Configuror, Rectifier, Synchronizer
// orchestrated by the Agent. Mirrors the SCSS (Self-Connector &
// Self-Synchronizer) design: an event-driven loop with drift detection,
// dead-letter awareness, and safe auto-remediation.
// ———————————————————————————————————————————————————

export type AgentPhase = 'connect' | 'test' | 'configure' | 'rectify' | 'sync'

export interface AgentStepResult {
  step: string
  status: 'ok' | 'warn' | 'error' | 'skipped'
  itemsAffected: number
  details: string
  durationMs: number
}

export interface AgentRun {
  phase: AgentPhase
  status: 'success' | 'error'
  steps: AgentStepResult[]
  startedAt: string
  durationMs: number
}

export interface ProviderConnectivity {
  provider: string
  configured: boolean
  enabled: boolean
  connected: boolean
  mode: 'live' | 'sandbox' | 'unconfigured' | 'unreachable'
  latencyMs: number
  details?: Record<string, unknown>
  error?: string
}

export type Severity = 'info' | 'warning' | 'critical'

export interface Finding {
  severity: Severity
  code: string
  title: string
  detail: string
  autoRemediable: boolean
  entityId?: string
}
