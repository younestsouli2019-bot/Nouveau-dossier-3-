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
 *   2. ALLOW if Authorization: Bearer <OPERATOR_TOKEN> or the operator_session
 *      cookie matches OPERATOR_TOKEN — this mirrors the global middleware gate.
 *   3. Otherwise 401 BEFORE any business logic or DB access.
 */
export function requireOpsAuth(request: NextRequest): NextResponse | null {
  const secret = process.env.OPS_API_SECRET || process.env.CRON_SECRET
  const provided = request.headers.get('x-ops-secret')
  if (secret && provided && safeEqual(provided.trim(), secret.trim())) {
    return null
  }

  const operatorToken = process.env.OPERATOR_TOKEN
  const bearer = getBearerToken(request.headers.get('authorization'))
  if (operatorToken && bearer && safeEqual(bearer, operatorToken.trim())) {
    return null
  }

  const sessionCookie = getCookieValue(request.headers.get('cookie'), 'operator_session')
  if (operatorToken && sessionCookie && safeEqual(sessionCookie, operatorToken.trim())) {
    return null
  }

  return NextResponse.json(
    {
      success: false,
      error:
        'Unauthorized: ops endpoints require x-ops-secret (OPS_API_SECRET / CRON_SECRET) or a valid operator token.',
    },
    { status: 401 },
  )
}

function getBearerToken(authorization: string | null): string | null {
  if (!authorization?.startsWith('Bearer ')) return null
  const token = authorization.slice(7).trim()
  return token || null
}

function getCookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rest] = part.trim().split('=')
    if (rawName !== name) continue
    const value = rest.join('=').trim()
    return value || null
  }
  return null
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}
