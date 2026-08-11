import { NextRequest, NextResponse } from 'next/server'
import { runFullCycle } from '@/lib/agentic'
import type { AgentPhase } from '@/lib/agentic/types'

/**
 * POST /api/ops/agentic/run — execute the full autonomous cycle
 *   Body: { phases?: AgentPhase[] } — subset of ['connect','test','configure','rectify','sync']
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const phases = (body.phases as AgentPhase[] | undefined)?.filter((p) =>
      ['connect', 'test', 'configure', 'rectify', 'sync'].includes(p),
    )

    const result = await runFullCycle({ phases })
    return NextResponse.json({
      success: result.success,
      startedAt: result.startedAt,
      totalDurationMs: result.totalDurationMs,
      runs: result.runs,
    })
  } catch (error) {
    console.error('Error running agentic cycle:', error)
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 })
  }
}
