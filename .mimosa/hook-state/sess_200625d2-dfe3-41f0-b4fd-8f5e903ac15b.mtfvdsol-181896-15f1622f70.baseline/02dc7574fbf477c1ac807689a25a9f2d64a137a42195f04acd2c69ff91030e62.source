// ——— Fabrication Kill-Switch ———
// Prevents any API endpoint from directly setting status='completed'
// without going through the strict verification pipeline.
//
// This is a request-level guard that wraps API handlers.
// It inspects the request body for fabrication attempts.
// —————————————————————————————

import { NextRequest, NextResponse } from 'next/server'

const FABRICATION_SIGNALS = [
  { field: 'status', value: 'completed', context: 'without external proof' },
]

/**
 * Detect fabrication attempts in a request body.
 * Uses iterative BFS with depth limit to prevent stack overflow on circular refs.
 */
export function detectFabrication(body: unknown): Array<{ field: string; value: unknown; context: string }> {
  const attempts: Array<{ field: string; value: unknown; context: string }> = []
  if (body == null || typeof body !== 'object') return attempts

  const MAX_DEPTH = 8
  const queue: Array<{ obj: Record<string, unknown>; path: string; depth: number }> = []
  const visited = new Set<object>()

  queue.push({ obj: body as Record<string, unknown>, path: 'body', depth: 0 })
  visited.add(body as object)

  while (queue.length > 0) {
    const { obj, path, depth } = queue.shift()!
    if (depth > MAX_DEPTH) continue

    for (const [key, value] of Object.entries(obj)) {
      for (const signal of FABRICATION_SIGNALS) {
        if (key === signal.field && value === signal.value) {
          attempts.push({ field: key, value, context: `${path}.${key}` })
        }
      }

      if (value && typeof value === 'object' && !visited.has(value)) {
        if (depth < MAX_DEPTH) {
          visited.add(value)
          queue.push({ obj: value as Record<string, unknown>, path: `${path}.${key}`, depth: depth + 1 })
        }
      }
    }
  }

  return attempts
}

/**
 * Kill fabrication attempts. Returns error response or null if clean.
 * Hides internal violation details from the client.
 */
export function killFabrication(body: unknown): NextResponse | null {
  const attempts = detectFabrication(body)

  if (attempts.length > 0) {
    console.error('[FABRICATION KILL-SWITCH] Blocked:', JSON.stringify(attempts))

    return NextResponse.json(
      {
        success: false,
        error: 'FABRICATION_KILLED',
        message: 'This endpoint has been killed by the Truth Enforcement system. ' +
          'Status transitions to "completed" require cryptographic or external network settlement confirmation.',
        timestamp: new Date().toISOString(),
      },
      { status: 422 }
    )
  }

  return null
}

/**
 * Wraps an API handler to automatically kill fabrication attempts.
 */
export function withFabricationGuard(
  handler: (req: NextRequest) => Promise<NextResponse>
) {
  return async (req: NextRequest) => {
    try {
      const clonedReq = req.clone()
      const body = await clonedReq.json().catch(() => ({}))

      if (body && typeof body === 'object') {
        const fabrication = killFabrication(body)
        if (fabrication) return fabrication
      }
    } catch {
      // If we can't parse the body, let the handler deal with it
    }

    return handler(req)
  }
}
