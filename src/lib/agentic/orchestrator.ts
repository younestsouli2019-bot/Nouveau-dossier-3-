// ——— Agent Orchestrator ———
// The autonomous loop: CONNECT → TEST → CONFIGURE → RECTIFY → SYNC.
// Runs the SCSS self-* agents in sequence, logs every phase to AutoPilotRun,
// and returns a combined report. No phase moves real money.

import { db } from '@/lib/db'
import { getMemoryStatus } from '@/lib/swarm/memory'
import { runConnector } from './self-connector'
import { runTester } from './self-tester'
import { runConfigurator } from './self-configurator'
import { runRectifier } from './rectifier'
import { snapshotState, compareSnapshots } from './synchronizer'
import type { AgentPhase, AgentRun, AgentStepResult } from './types'

async function runSynchronizer(): Promise<AgentRun> {
  const start = Date.now()
  const steps: AgentStepResult[] = []

  const before = await compareSnapshots()
  const snapshot = await snapshotState('post_reconciliation')

  steps.push({
    step: 'sync_state_ledger',
    status: 'ok',
    itemsAffected: 1,
    details: `Snapshot ${snapshot.id.slice(-8)} recorded with integrity hash ${snapshot.integrityHash?.slice(0, 12)}…`,
    durationMs: Date.now() - start,
  })
  steps.push({
    step: 'compare_snapshots',
    status: before && before.drift ? 'warn' : 'ok',
    itemsAffected: before?.changes.length ?? 0,
    details: before
      ? before.drift
        ? `Drift across ${before.changes.length} field(s): ${before.changes.map((c) => `${c.field} ${c.from}→${c.to}`).join(', ')}`
        : 'No drift between snapshots'
      : 'Insufficient snapshots to compare',
    durationMs: 0,
  })

  return {
    phase: 'sync',
    status: 'success',
    steps,
    startedAt: new Date(start).toISOString(),
    durationMs: Date.now() - start,
  }
}

export async function runFullCycle(opts: { phases?: AgentPhase[] } = {}): Promise<{
  success: boolean
  runs: AgentRun[]
  startedAt: string
  totalDurationMs: number
}> {
  const startedAt = new Date()
  const phaseFns: Array<{ phase: AgentPhase; fn: () => Promise<AgentRun> }> = [
    { phase: 'connect', fn: runConnector },
    { phase: 'test', fn: runTester },
    { phase: 'configure', fn: runConfigurator },
    { phase: 'rectify', fn: runRectifier },
    { phase: 'sync', fn: runSynchronizer },
  ]

  const requested = opts.phases?.length ? new Set(opts.phases) : null
  const runs: AgentRun[] = []

  for (const { phase, fn } of phaseFns) {
    if (requested && !requested.has(phase)) continue
    try {
      const run = await fn()
      runs.push(run)
    } catch (error) {
      runs.push({
        phase,
        status: 'error',
        steps: [{ step: phase, status: 'error', itemsAffected: 0, details: String(error), durationMs: 0 }],
        startedAt: new Date().toISOString(),
        durationMs: 0,
      })
    }
  }

  // Persist phase logs for observability
  for (const run of runs) {
    await db.autoPilotRun.create({
      data: {
        trigger: 'agentic',
        phase: run.phase,
        status: run.status,
        itemsAffected: run.steps.reduce((s, st) => s + st.itemsAffected, 0),
        amountAffected: 0,
        details: run.steps.map((s) => `${s.step}: ${s.status}`).join(' | '),
        durationMs: run.durationMs,
      },
    }).catch(() => undefined)
  }

  const totalDurationMs = Date.now() - startedAt.getTime()
  const success = runs.every((r) => r.status === 'success')

  return { success, runs, startedAt: startedAt.toISOString(), totalDurationMs }
}

export async function getAgenticStatus() {
  const [lastRuns, connectivity, snapshot, memory] = await Promise.all([
    db.autoPilotRun.findMany({
      where: { trigger: 'agentic' },
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
    runConnector(),
    compareSnapshots(),
    getMemoryStatus(),
  ])

  return {
    connectedProviders: connectivity.steps[0],
    lastRuns: lastRuns.map((r) => ({
      phase: r.phase,
      status: r.status,
      itemsAffected: r.itemsAffected,
      details: r.details,
      durationMs: r.durationMs,
      createdAt: r.createdAt.toISOString(),
    })),
    latestSnapshot: snapshot,
    memory,
  }
}
