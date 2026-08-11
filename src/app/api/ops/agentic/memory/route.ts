import { NextRequest, NextResponse } from 'next/server'
import { getMemoryStatus, rememberIncident } from '@/lib/swarm/memory'

/**
 * GET  /api/ops/agentic/memory — swarm collective memory status
 * POST /api/ops/agentic/memory — { action: 'remember' } record an incident
 */
export async function GET() {
  try {
    const memory = await getMemoryStatus()
    return NextResponse.json({ success: true, memory })
  } catch (error) {
    console.error('Error reading swarm memory:', error)
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const action = body.action as string | undefined

    if (action === 'remember') {
      if (!body.code || !body.message) {
        return NextResponse.json(
          { success: false, error: 'code and message are required' },
          { status: 400 },
        )
      }
      const result = await rememberIncident({
        code: String(body.code),
        severity: (body.severity as 'info' | 'warning' | 'critical') ?? 'warning',
        component: String(body.component ?? 'external'),
        message: String(body.message),
        context: body.context ? JSON.parse(JSON.stringify(body.context)) : undefined,
      })
      return NextResponse.json({ success: true, ...result })
    }

    return NextResponse.json(
      { success: false, error: "action must be 'remember'" },
      { status: 400 },
    )
  } catch (error) {
    console.error('Error writing swarm memory:', error)
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 })
  }
}
