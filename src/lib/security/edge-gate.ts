/**
 * Edge-safe security gate for middleware (Edge Runtime).
 *
 * Mirrors the request-gating behavior of ./rate-limit.ts and ./bad-actor.ts
 * (same constants, same block rules) but is fully Edge-compatible: in-memory
 * state only, no fs, no process.versions/process.cwd, no require().
 *
 * Node-runtime API routes keep importing the full libs (disk spillover +
 * ndjson security logging). Middleware must import ONLY this module so the
 * Turbopack Edge trace never pulls Node APIs in.
 */

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

export interface BadActorResult {
  blocked: boolean;
  reason?: string;
}

type BucketState = { tokens: number; lastRefill: number };

const DEFAULT_RATE_PER_MINUTE = 60;
const DEFAULT_BURST = 120;
const REFILL_INTERVAL_MS = 1000;
const TOKENS_PER_REFILL = DEFAULT_RATE_PER_MINUTE / 60;

const LOOSE_BUCKET_PATHS = [
  '/api/healthz',
  '/api/ai-tools/status',
  '/.well-known',
  '/robots.txt',
];

const LOOSE_RATE_PER_MINUTE = 600;
const LOOSE_BURST = 1200;
const LOOSE_TOKENS_PER_REFILL = LOOSE_RATE_PER_MINUTE / 60;

const UA_BLOCKLIST = [
  'sqlmap',
  'nikto',
  'nmap',
  'masscan',
  'zgrab',
  'zmap',
  'dirbuster',
  'gobuster',
  'wfuzz',
  'wpscan',
  'joomscan',
  'cmsmap',
  'nuclei',
  'acunetix',
  'nessus',
  'openvas',
  'burpsuite',
  'metasploit',
  'havij',
  'sqlninja',
];

const STATE_KEY = '__SWARM_EDGE_GATE_V1__' as const;

interface EdgeGateState {
  buckets: Map<string, BucketState>;
}

function getStore(): EdgeGateState {
  const g = globalThis as any;
  if (!g[STATE_KEY]) {
    g[STATE_KEY] = { buckets: new Map<string, BucketState>() };
  }
  return g[STATE_KEY] as EdgeGateState;
}

function getClientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = headers.get('x-real-ip');
  if (realIp) return realIp;
  return 'unknown';
}

function extractPathname(request: Request | { headers: Headers; method?: string; nextUrl?: { pathname: string } }): string {
  if ('nextUrl' in request && (request as any).nextUrl) {
    return (request as any).nextUrl.pathname as string;
  }
  if ('url' in request && typeof (request as any).url === 'string') {
    try { return new URL((request as any).url).pathname; } catch { /* ignore */ }
  }
  return 'unknown';
}

function isLoosePath(pathname: string): boolean {
  return LOOSE_BUCKET_PATHS.some(p => pathname.startsWith(p));
}

export function checkRateLimitEdge(
  request: Request | { headers: Headers; nextUrl?: { pathname: string } },
): RateLimitResult {
  const pathname = extractPathname(request);
  const ip = getClientIpFromHeaders(request.headers);
  const loose = isLoosePath(pathname);
  const burst = loose ? LOOSE_BURST : DEFAULT_BURST;
  const tokensPerRefill = loose ? LOOSE_TOKENS_PER_REFILL : TOKENS_PER_REFILL;
  const key = `${loose ? 'loose:' : 'strict:'}${ip}`;

  const store = getStore().buckets;
  const now = Date.now();
  let state = store.get(key);
  if (!state) {
    state = { tokens: burst, lastRefill: now };
    store.set(key, state);
  }

  const elapsed = now - state.lastRefill;
  if (elapsed >= REFILL_INTERVAL_MS) {
    const refillTicks = Math.floor(elapsed / REFILL_INTERVAL_MS);
    state.tokens = Math.min(burst, state.tokens + refillTicks * tokensPerRefill);
    state.lastRefill = now - (elapsed % REFILL_INTERVAL_MS);
  }

  if (state.tokens >= 1) {
    state.tokens -= 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  const tokensNeeded = 1 - state.tokens;
  const refillMs = Math.ceil(tokensNeeded / Math.max(0.001, tokensPerRefill)) * REFILL_INTERVAL_MS;
  return { allowed: false, retryAfterMs: refillMs };
}

export function checkBadActorEdge(
  request: Request | { headers: Headers; method?: string; nextUrl?: { pathname: string } },
): BadActorResult {
  const headers = request.headers;
  const method = 'method' in request ? ((request as any).method as string) : 'GET';
  const ua = headers.get('user-agent') ?? '';
  const uaLower = ua.toLowerCase();

  for (const blocked of UA_BLOCKLIST) {
    if (uaLower.includes(blocked)) {
      return { blocked: true, reason: `Blocked UA: ${blocked}` };
    }
  }

  const secFetchDest = headers.get('sec-fetch-dest');
  const secFetchMode = headers.get('sec-fetch-mode');
  const secFetchSite = headers.get('sec-fetch-site');
  const hasAnySecFetch = secFetchDest !== null || secFetchMode !== null || secFetchSite !== null;
  const hasMissingAnomaly = hasAnySecFetch && !secFetchDest;

  if (method === 'POST' && hasMissingAnomaly) {
    return { blocked: true, reason: 'Sec-Fetch anomaly' };
  }

  const xff = headers.get('x-forwarded-for');
  const xri = headers.get('x-real-ip');
  if (xff && xri) {
    const xffFirst = xff.split(',')[0]?.trim();
    if (xffFirst && xffFirst !== xri) {
      return { blocked: true, reason: 'X-Forwarded mismatch' };
    }
  }

  return { blocked: false };
}
