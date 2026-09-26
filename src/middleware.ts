import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { checkRateLimit } from '@/lib/security/rate-limit';
import { checkBadActor } from '@/lib/security/bad-actor';

let cachedNodeCrypto: typeof import('crypto') | null = null;
function getNodeCrypto(): typeof import('crypto') | null {
  if (cachedNodeCrypto) return cachedNodeCrypto;
  try {
    if (typeof process !== 'undefined' && (process.versions as any)?.node) {
      cachedNodeCrypto = require('crypto') as typeof import('crypto');
      return cachedNodeCrypto;
    }
  } catch { /* ignore */ }
  return null;
}

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
  const nc = getNodeCrypto();
  if (nc) return nc.randomBytes(16).toString('hex');
  return webHex(16);
}

function generateCsrfToken(): string {
  const nc = getNodeCrypto();
  if (nc) return nc.randomBytes(32).toString('hex');
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

const isDev = process.env.NODE_ENV !== 'production';

function buildCsp(nonce: string): string {
  const parts = [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic' https: 'self'` + (isDev ? " 'unsafe-eval'" : ''),
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' https://www.realworldcerts.com https://api.realworldcerts.com https://payment.cmi.co.ma https://testpayment.cmi.co.ma https://*.space-z.ai" + (isDev ? ' ws:' : ''),
    "frame-ancestors 'none'",
    "object-src 'none'",
    "form-action 'self'",
    "base-uri 'self'",
  ];
  return parts.join('; ');
}

function applySecureCookie(response: NextResponse, name: string, value: string) {
  const attrs = [
    `HttpOnly`,
    `SameSite=Strict`,
    `Path=/`,
  ];
  if (!isDev) {
    attrs.push('Secure');
  }
  response.cookies.set(name, value, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    secure: !isDev,
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

function isBrowserNavigation(headers: Headers): boolean {
  const secFetchDest = headers.get('sec-fetch-dest');
  return secFetchDest === 'document' || secFetchDest === 'iframe' || secFetchDest === 'frame';
}

function isBrowserPost(headers: Headers): boolean {
  const secFetchDest = headers.get('sec-fetch-dest');
  const secFetchMode = headers.get('sec-fetch-mode');
  const secFetchSite = headers.get('sec-fetch-site');
  if (!secFetchDest && !secFetchMode && !secFetchSite) {
    return false;
  }
  return secFetchDest === 'empty' || secFetchMode === 'cors' || secFetchMode === 'navigate' || secFetchMode === 'same-origin' || secFetchMode === 'no-cors';
}

export async function middleware(request: NextRequest) {
  const badActor = checkBadActor(request);
  if (badActor.blocked) {
    return NextResponse.json(
      { code: 'BAD_ACTOR' },
      { status: 403 },
    );
  }

  const rateLimit = checkRateLimit(request);
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

  if (!isDev) {
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
        if (isDev) {
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
