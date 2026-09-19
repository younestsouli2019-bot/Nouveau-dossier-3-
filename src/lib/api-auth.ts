import { timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Ops route auth (2026-08-30 hardening).
 *
 * Mutation routes (/api/shipments/verify, /verify-all, /api/carrier-tracking,
 * /api/ops/auto-pilot POST) previously had ZERO authentication — anyone with the
 * deployed URL could drive verification / autopilot.
 *
 * Policy (fail-closed in production):
 *   1. ALLOW if header `x-ops-secret` matches OPS_API_SECRET || CRON_SECRET
 *      (constant-time compare) — the same secret-gate pattern as the swarm daemon.
 *   2. ALLOW if `Authorization: Bearer <OPERATOR_TOKEN>` matches the operator token.
 *   3. ALLOW if `operator_session` cookie matches OPERATOR_TOKEN.
 *   4. In local development only, allow same-origin browser requests so the dashboard
 *      can call these endpoints without wiring production secrets into the client.
 *   5. Otherwise 401 BEFORE any business logic or DB access.
 */
export function requireOpsAuth(request: NextRequest): NextResponse | null {
  const secret = (process.env.OPS_API_SECRET || process.env.CRON_SECRET || '').trim()
  const operatorToken = (process.env.OPERATOR_TOKEN || '').trim()

  const providedSecret = request.headers.get('x-ops-secret')?.trim()
  if (secret && providedSecret && safeEqual(providedSecret, secret)) {
    return null
  }

  const authHeader = request.headers.get('authorization')
  if (operatorToken && authHeader?.startsWith('Bearer ')) {
    const bearerToken = authHeader.slice(7).trim()
    if (bearerToken && safeEqual(bearerToken, operatorToken)) {
      return null
    }
  }

  const sessionCookie = request.cookies.get('operator_session')?.value?.trim()
  if (operatorToken && sessionCookie && safeEqual(sessionCookie, operatorToken)) {
    return null
  }

  const site = request.headers.get('sec-fetch-site')
  if (process.env.NODE_ENV !== 'production' && (site === 'same-origin' || site === 'same-site')) {
    return null
  }

  const configuredAuth = secret || operatorToken
  return NextResponse.json(
    {
      success: false,
      error: configuredAuth
        ? 'Unauthorized: mutation endpoints require x-ops-secret (OPS_API_SECRET / CRON_SECRET), Authorization: Bearer OPERATOR_TOKEN, or an operator_session cookie.'
        : 'Unauthorized: configure OPS_API_SECRET, CRON_SECRET, or OPERATOR_TOKEN to unlock ops mutation endpoints outside local development.',
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
