import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PROTECTED_POST_PATHS = [
  '/api/payout-batches',
  '/api/payout-batches/approve',
  '/api/payout-batches/submit-real',
  '/api/payout-batches/submit-wire',
  '/api/payout-batches/resubmit-all',
  '/api/procurement',
  '/api/procurement/advance',
  '/api/procurement/pay-bridge',
  '/api/procurement/fulfill-batch',
  '/api/procurement/wet-run',
  '/api/procurement/seed-workflow',
  '/api/settlements/settle-and-payout',
  '/api/settlements/wet-run',
  '/api/revenue/strict',
  '/api/settle/strict',
  '/api/escalations',
  '/api/escalations/auto-escalate',
  '/api/carrier-tracking',
  '/api/suppliers',
  '/api/attijari',
  '/api/bybit',
  '/api/crypto-accounts',
]

const CONSTANT_TIME_COMPARE = (a: string, b: string) => {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

export function middleware(request: NextRequest) {
  const response = NextResponse.next()

  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('X-DNS-Prefetch-Control', 'off')
  response.headers.set('X-Permitted-Cross-Domain-Policies', 'none')
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin')
  response.headers.set('Cross-Origin-Resource-Policy', 'same-origin')

  const isDev = process.env.NODE_ENV !== 'production'
  const csp = [
    "default-src 'self'",
    "script-src 'self'" + (isDev ? " 'unsafe-eval' 'unsafe-inline'" : ''),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'" + (isDev ? ' ws:' : ''),
    "frame-ancestors 'none'",
    "object-src 'none'",
    "form-action 'self'",
    "base-uri 'self'",
  ].join('; ')
  response.headers.set('Content-Security-Policy', csp)

  if (!isDev) {
    response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  }

  if (request.method === 'POST') {
    const path = request.nextUrl.pathname
    const isProtected = PROTECTED_POST_PATHS.some(p => path.startsWith(p))

    if (isProtected) {
      const operatorToken = process.env.OPERATOR_TOKEN
      if (!operatorToken) {
        if (isDev) {
          console.warn(`[Middleware] OPERATOR_TOKEN not set — allowing POST ${path} in dev mode`)
          return response
        }
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
      }

      const authHeader = request.headers.get('authorization')
      const sessionCookie = request.cookies.get('operator_session')?.value

      let providedToken = ''
      if (authHeader?.startsWith('Bearer ')) {
        providedToken = authHeader.slice(7)
      } else if (sessionCookie) {
        providedToken = sessionCookie
      }

      if (!providedToken || !CONSTANT_TIME_COMPARE(providedToken, operatorToken)) {
        return NextResponse.json({ error: 'Invalid authentication' }, { status: 401 })
      }
    }
  }

  return response
}

export const config = {
  matcher: ['/api/:path*'],
}
