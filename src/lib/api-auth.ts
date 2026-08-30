import { timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Ops route auth (2026-08-30 hardening).
 *
 * Mutation routes (/api/shipments/verify, /verify-all, /api/carrier-tracking,
 * /api/ops/auto-pilot POST) previously had ZERO authentication — anyone with the
 * deployed URL could drive verification / autopilot.
 *
 * Policy (fail-closed for scripts, transparent for the operator's own UI):
 *   1. ALLOW if header `x-ops-secret` matches OPS_API_SECRET || CRON_SECRET
 *      (constant-time compare) — the same secret-gate pattern as the swarm daemon.
 *   2. ALLOW if the browser attests same-origin (`sec-fetch-site: same-origin|same-site`)
 *      — dashboard fetch() calls always send this; cross-origin scripts/curl do not.
 *   3. Otherwise 401 BEFORE any business logic or DB access.
 */
export function requireOpsAuth(request: NextRequest): NextResponse | null {
  const secret = process.env.OPS_API_SECRET || process.env.CRON_SECRET
  const provided = request.headers.get('x-ops-secret')
  if (secret && provided && safeEqual(provided.trim(), secret.trim())) {
    return null
  }

  const site = request.headers.get('sec-fetch-site')
  if (site === 'same-origin' || site === 'same-site') {
    return null
  }

  return NextResponse.json(
    {
      success: false,
      error: 'Unauthorized: mutation endpoints require a same-origin request or the x-ops-secret header (OPS_API_SECRET / CRON_SECRET).',
    },
    { status: 401 },
  )
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}
