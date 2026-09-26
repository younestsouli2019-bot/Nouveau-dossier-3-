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

function isNodeRuntime(): boolean {
  try {
    if (typeof process !== 'undefined' && (process.versions as any)?.node) return true;
    return false;
  } catch {
    return false;
  }
}

const HAS_NODE = isNodeRuntime();
let fsMod: typeof import('fs') | null = null;
let pathMod: typeof import('path') | null = null;
let cryptoMod: typeof import('crypto') | null = null;
let logPathCached: string | null = null;

function getNodeDeps(): { fs: typeof import('fs'); path: typeof import('path'); crypto: typeof import('crypto'); logPath: string } | null {
  if (!HAS_NODE) return null;
  try {
    if (!fsMod) fsMod = require('fs') as typeof import('fs');
    if (!pathMod) pathMod = require('path') as typeof import('path');
    if (!cryptoMod) cryptoMod = require('crypto') as typeof import('crypto');
    if (!logPathCached && pathMod && typeof process !== 'undefined' && process.cwd) {
      logPathCached = pathMod.join(process.cwd(), 'data', 'out', 'security-gate.ndjson');
    }
    if (!fsMod || !pathMod || !cryptoMod || !logPathCached) return null;
    return { fs: fsMod, path: pathMod, crypto: cryptoMod, logPath: logPathCached };
  } catch {
    return null;
  }
}

function webRandomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try { return crypto.randomUUID(); } catch { /* ignore */ }
  }
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function ensureDir(dirPath: string, fs: typeof import('fs')): void {
  try { fs.mkdirSync(dirPath, { recursive: true }); } catch { /* ignore */ }
}

export function logSecurityEvent(event: Record<string, unknown>): void {
  const deps = getNodeDeps();
  if (!deps) return;
  const { fs, path, crypto, logPath } = deps;
  try {
    ensureDir(path.dirname(logPath), fs);
    const entry = {
      id: (crypto && typeof crypto.randomUUID === 'function') ? crypto.randomUUID() : webRandomId(),
      timestamp: Date.now(),
      ...event,
    };
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf8');
  } catch { /* ignore */ }
}

function getClientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = headers.get('x-real-ip');
  if (realIp) return realIp;
  return 'unknown';
}

export interface BadActorResult {
  blocked: boolean;
  reason?: string;
}

export function checkBadActor(request: Request | { headers: Headers; method?: string; nextUrl?: { pathname: string } }): BadActorResult {
  const headers = request.headers;
  const method = 'method' in request ? (request.method as string) : 'GET';
  const pathname = 'nextUrl' in request && (request as any).nextUrl ? (request as any).nextUrl.pathname : 'unknown';
  const ua = headers.get('user-agent') ?? '';
  const uaLower = ua.toLowerCase();

  for (const blocked of UA_BLOCKLIST) {
    if (uaLower.includes(blocked)) {
      logSecurityEvent({
        type: 'bad_actor',
        reason: 'blocked_ua',
        ua,
        ip: getClientIp(headers),
        method,
        pathname,
        matched: blocked,
      });
      return { blocked: true, reason: `Blocked UA: ${blocked}` };
    }
  }

  const secFetchDest = headers.get('sec-fetch-dest');
  const secFetchMode = headers.get('sec-fetch-mode');
  const secFetchSite = headers.get('sec-fetch-site');

  const hasAnySecFetch = secFetchDest !== null || secFetchMode !== null || secFetchSite !== null;
  const hasMissingAnomaly = hasAnySecFetch && !secFetchDest;

  if (method === 'POST' && hasMissingAnomaly) {
    logSecurityEvent({
      type: 'bad_actor',
      reason: 'sec_fetch_anomaly',
      ua,
      ip: getClientIp(headers),
      method,
      pathname,
      secFetchDest,
      secFetchMode,
      secFetchSite,
    });
    return { blocked: true, reason: 'Sec-Fetch anomaly' };
  }

  const xff = headers.get('x-forwarded-for');
  const xri = headers.get('x-real-ip');
  if (xff && xri) {
    const xffFirst = xff.split(',')[0]?.trim();
    if (xffFirst && xffFirst !== xri) {
      logSecurityEvent({
        type: 'bad_actor',
        reason: 'x_forwarded_mismatch',
        ua,
        ip: getClientIp(headers),
        method,
        pathname,
        xForwardedFor: xff,
        xRealIp: xri,
      });
      return { blocked: true, reason: 'X-Forwarded mismatch' };
    }
  }

  return { blocked: false };
}

export function getBlockedUaList(): string[] {
  return [...UA_BLOCKLIST];
}
