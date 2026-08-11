import { NextRequest, NextResponse } from 'next/server'
import { runPsd2Connectivity, refreshPsd2Token, getPsd2Health } from '@/lib/psd2'

/**
 * GET  /api/ops/agentic/psd2 — PSD2 bank health snapshot + metrics
 * POST /api/ops/agentic/psd2 — { action: 'run' } probe all banks,
 *                              { action: 'refresh', bankId } force token refresh
 */
export async function GET() {
  try {
    const health = await getPsd2Health()
    return NextResponse.json({ success: true, ...health })
  } catch (error) {
    console.error('Error reading PSD2 health:', error)
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const action = body.action as string | undefined

    if (action === 'run') {
      const results = await runPsd2Connectivity(body.bankIds as string[] | undefined)
      return NextResponse.json({ success: true, connectors: results })
    }

    if (action === 'refresh') {
      if (!body.bankId) {
        return NextResponse.json({ success: false, error: 'bankId is required' }, { status: 400 })
      }
      const result = await refreshPsd2Token(body.bankId as string)
      return NextResponse.json({ success: result.refreshed, ...result })
    }

    return NextResponse.json(
      { success: false, error: "action must be 'run' or 'refresh'" },
      { status: 400 },
    )
  } catch (error) {
    console.error('Error running PSD2 engine:', error)
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 })
  }
}
