import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { checkRateLimitEdge } from '@/lib/security/edge-gate';
import { checkBadActorEdge } from '@/lib/security/edge-gate';

function webHex(bytes: number): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const arr = new Uint8Array(bytes);
    crypto.getRandomValues(arr);
    return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  const out: string[] = [];
  for (let i = 0; i < bytes; i++) out.push(Math.floor(Math.random() * 256).toString(16).padStart(2, '0'));
  return out.join('');
}

function generateNonce(): string {
  return webHex(16);
}

function generateCsrfToken(): string {
  return webHex(32);
}

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
];

const CONSTANT_TIME_COMPARE = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
};

// Fail-closed: ONLY an explicit development/test marker counts as dev mode.
// An unset NODE_ENV must not relax the CSP, and above all must not bypass the
// OPERATOR_TOKEN check on protected money POSTs (see the `if (isProtected)` branch).
// Read per-call (never cached at module load) so a runtime/test env change is honoured.
function isDevEnv(): boolean {
  return process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
}

function buildCsp(nonce: string): string {
  const parts = [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic' https: 'self'` + (isDevEnv() ? " 'unsafe-eval'" : ''),
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' https://www.realworldcerts.com https://api.realworldcerts.com https://payment.cmi.co.ma https://testpayment.cmi.co.ma https://*.space-z.ai" + (isDevEnv() ? ' ws:' : ''),
    "frame-ancestors 'none'",
    "object-src 'none'",
    "form-action 'self'",
    "base-uri 'self'",
  ];
  return parts.join('; ');
}

function applySecureCookie(response: NextResponse, name: string, value: string) {
  response.cookies.set(name, value, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    secure: !isDevEnv(),
  });
}

async function extractSubmittedCsrf(request: NextRequest): Promise<string | null> {
  const headerToken = request.headers.get('x-csrf-token');
  if (headerToken) return headerToken;

  const contentType = request.headers.get('content-type') ?? '';
  try {
    const cloned = request.clone();
    if (contentType.includes('application/json')) {
      const body = await cloned.json().catch(() => null);
      if (body && typeof body._csrf === 'string') {
        return body._csrf;
      }
    } else if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
      const formData = await cloned.formData().catch(() => null);
      if (formData) {
        const field = formData.get('_csrf');
        if (field && typeof field === 'string') {
          return field;
        }
      }
    }
  } catch {
  }
  return null;
}

export async function middleware(request: NextRequest) {
  const badActor = checkBadActorEdge(request);
  if (badActor.blocked) {
    return NextResponse.json(
      { code: 'BAD_ACTOR' },
      { status: 403 },
    );
  }

  const rateLimit = checkRateLimitEdge(request);
  if (!rateLimit.allowed) {
    const retrySec = Math.ceil(rateLimit.retryAfterMs / 1000);
    return NextResponse.json(
      { code: 'RATE_LIMITED', retryAfterMs: rateLimit.retryAfterMs },
      {
        status: 429,
        headers: {
          'Retry-After': String(retrySec),
        },
      },
    );
  }

  const response = NextResponse.next();

  const nonce = generateNonce();
  response.headers.set('x-csp-nonce', nonce);

  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-DNS-Prefetch-Control', 'off');
  response.headers.set('X-Permitted-Cross-Domain-Policies', 'none');
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');

  const csp = buildCsp(nonce);
  response.headers.set('Content-Security-Policy', csp);

  if (!isDevEnv()) {
    response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }

  let csrfToken = request.cookies.get('_csrf')?.value;
  if (!csrfToken) {
    csrfToken = generateCsrfToken();
    applySecureCookie(response, '_csrf', csrfToken);
  }

  const existingSessionCookie = request.cookies.get('operator_session');
  if (existingSessionCookie?.value) {
    applySecureCookie(response, 'operator_session', existingSessionCookie.value);
  }

  // Admin-only reads: order lookup, payment config. The route also
  // authenticates internally, but reject unauthenticated calls here so
  // they never reach the handler.
  if (request.method === 'GET') {
    const ADMIN_READ_PATHS = ['/api/orders', '/api/owner-payments'];
    const path = request.nextUrl.pathname;
    if (ADMIN_READ_PATHS.some(p => path === p || path.startsWith(`${p}/`))) {
      const operatorToken = process.env.OPERATOR_TOKEN;
      if (!operatorToken) {
        if (!isDevEnv()) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
      } else {
        const authHeader = request.headers.get('authorization');
        const sessionCookie = request.cookies.get('operator_session')?.value;
        const provided = authHeader?.startsWith('Bearer ')
          ? authHeader.slice(7)
          : sessionCookie ?? '';
        if (!provided || !CONSTANT_TIME_COMPARE(provided, operatorToken)) {
          return NextResponse.json({ error: 'Invalid authentication' }, { status: 401 });
        }
      }
    }
  }

  if (request.method === 'POST' || request.method === 'PUT' || request.method === 'DELETE' || request.method === 'PATCH') {
    const path = request.nextUrl.pathname;
    const isProtected = PROTECTED_POST_PATHS.some(p => path.startsWith(p));

    const hasAnySecFetch =
      request.headers.get('sec-fetch-dest') !== null ||
      request.headers.get('sec-fetch-mode') !== null ||
      request.headers.get('sec-fetch-site') !== null;
    const hasAuthHeader = Boolean(request.headers.get('authorization'));
    const needsCsrfCheck = hasAnySecFetch && !hasAuthHeader;

    if (needsCsrfCheck) {
      const submitted = await extractSubmittedCsrf(request);
      const cookieCsrf = request.cookies.get('_csrf')?.value;
      if (!submitted || !cookieCsrf || !CONSTANT_TIME_COMPARE(submitted, cookieCsrf)) {
        return NextResponse.json(
          { code: 'CSRF_MISMATCH' },
          { status: 403 },
        );
      }
    }

    if (isProtected) {
      const operatorToken = process.env.OPERATOR_TOKEN;
      if (!operatorToken) {
        if (isDevEnv()) {
          console.warn(`[Middleware] OPERATOR_TOKEN not set — allowing ${request.method} ${path} in dev mode`);
          return response;
        }
        return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
      }

      const authHeader = request.headers.get('authorization');
      const sessionCookie = request.cookies.get('operator_session')?.value;

      let providedToken = '';
      if (authHeader?.startsWith('Bearer ')) {
        providedToken = authHeader.slice(7);
      } else if (sessionCookie) {
        providedToken = sessionCookie;
      }

      if (!providedToken || !CONSTANT_TIME_COMPARE(providedToken, operatorToken)) {
        return NextResponse.json({ error: 'Invalid authentication' }, { status: 401 });
      }
    }
  }

  return response;
}

export const config = {
  matcher: ['/api/:path*', '/.well-known/:path*', '/robots.txt'],
};
