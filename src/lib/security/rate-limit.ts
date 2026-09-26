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

const STATE_KEY = '__SWARM_RATE_LIMIT_V1__' as const;
type StoreShape = Map<string, BucketState>;
function getStore(): StoreShape {
  const g = globalThis as any;
  if (!g[STATE_KEY]) {
    g[STATE_KEY] = new Map<string, BucketState>();
  }
  return g[STATE_KEY] as StoreShape;
}
const bucketStore: StoreShape = getStore();

function canUseNodeFs(): boolean {
  try {
    if (typeof process !== 'undefined' && (process.versions as any)?.node) return true;
    return false;
  } catch {
    return false;
  }
}

const HAS_NODE_FS = canUseNodeFs();

let fsMod: typeof import('fs') | null = null;
let pathMod: typeof import('path') | null = null;
let spilloverPath: string | null = null;

function ensureNodeDeps(): { fs: typeof import('fs'); path: typeof import('path'); spill: string } | null {
  if (!HAS_NODE_FS) return null;
  try {
    if (!fsMod) fsMod = require('fs') as typeof import('fs');
    if (!pathMod) pathMod = require('path') as typeof import('path');
    if (!spilloverPath && pathMod && typeof process !== 'undefined' && process.cwd) {
      spilloverPath = pathMod.join(process.cwd(), 'data', 'out', 'ratelimit-state.ndjson');
    }
    if (!fsMod || !pathMod || !spilloverPath) return null;
    return { fs: fsMod, path: pathMod, spill: spilloverPath };
  } catch {
    return null;
  }
}

function ensureDir(dirPath: string, fs: typeof import('fs')): void {
  try { fs.mkdirSync(dirPath, { recursive: true }); } catch { /* ignore */ }
}

export function spillRateLimitState(): void {
  const deps = ensureNodeDeps();
  if (!deps) return;
  const { fs, path, spill } = deps;
  try {
    ensureDir(path.dirname(spill), fs);
    const entries: string[] = [];
    bucketStore.forEach((state, key) => {
      entries.push(JSON.stringify({ key, tokens: state.tokens, lastRefill: state.lastRefill }));
    });
    fs.writeFileSync(spill, entries.join('\n') + (entries.length ? '\n' : ''), 'utf8');
  } catch { /* ignore */ }
}

export function loadRateLimitState(): void {
  const deps = ensureNodeDeps();
  if (!deps) return;
  const { fs, spill } = deps;
  try {
    if (!fs.existsSync(spill)) return;
    const content = fs.readFileSync(spill, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.key && typeof parsed.tokens === 'number' && typeof parsed.lastRefill === 'number') {
          bucketStore.set(parsed.key, { tokens: parsed.tokens, lastRefill: parsed.lastRefill });
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

if (HAS_NODE_FS && typeof process !== 'undefined' && typeof process.on === 'function') {
  try {
    process.on('SIGHUP', spillRateLimitState);
    process.on('SIGTERM', spillRateLimitState);
  } catch { /* ignore */ }
}
if (HAS_NODE_FS) loadRateLimitState();

function isLoosePath(pathname: string): boolean {
  return LOOSE_BUCKET_PATHS.some(p => pathname.startsWith(p));
}

function getClientIp(request: Request | { headers: Headers; nextUrl?: { pathname: string } }): string {
  const headers = request.headers;
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = headers.get('x-real-ip');
  if (realIp) return realIp;
  return 'unknown';
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

export function checkRateLimit(request: Request | { headers: Headers; nextUrl?: { pathname: string } }): RateLimitResult {
  let pathname = 'unknown';
  if ('nextUrl' in request && request.nextUrl) {
    pathname = request.nextUrl.pathname;
  } else if ('url' in request && typeof (request as any).url === 'string') {
    try { pathname = new URL((request as any).url).pathname; } catch { /* ignore */ }
  }
  const ip = getClientIp(request);
  const loose = isLoosePath(pathname);
  const ratePerMinute = loose ? LOOSE_RATE_PER_MINUTE : DEFAULT_RATE_PER_MINUTE;
  const burst = loose ? LOOSE_BURST : DEFAULT_BURST;
  const tokensPerRefill = loose ? LOOSE_TOKENS_PER_REFILL : TOKENS_PER_REFILL;
  const key = `${loose ? 'loose:' : 'strict:'}${ip}`;

  const now = Date.now();
  let state = bucketStore.get(key);

  if (!state) {
    state = { tokens: burst, lastRefill: now };
    bucketStore.set(key, state);
  }

  const elapsed = now - state.lastRefill;
  if (elapsed >= REFILL_INTERVAL_MS) {
    const refillTicks = Math.floor(elapsed / REFILL_INTERVAL_MS);
    state.tokens = Math.min(burst, state.tokens + refillTokensSanely(state.tokens, refillTicks, tokensPerRefill));
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

function refillTokensSanely(current: number, ticks: number, per: number): number {
  return ticks * per;
}

export function getRateLimitSnapshot() {
  return {
    strictBuckets: Array.from(bucketStore.entries())
      .filter(([k]) => k.startsWith('strict:'))
      .map(([k, v]) => ({ ip: k.slice(7), tokens: v.tokens, lastRefill: v.lastRefill })),
    looseBuckets: Array.from(bucketStore.entries())
      .filter(([k]) => k.startsWith('loose:'))
      .map(([k, v]) => ({ ip: k.slice(6), tokens: v.tokens, lastRefill: v.lastRefill })),
    totalBuckets: bucketStore.size,
    config: {
      strict: { ratePerMinute: DEFAULT_RATE_PER_MINUTE, burst: DEFAULT_BURST },
      loose: { ratePerMinute: LOOSE_RATE_PER_MINUTE, burst: LOOSE_BURST, paths: LOOSE_BUCKET_PATHS },
    },
  };
}
