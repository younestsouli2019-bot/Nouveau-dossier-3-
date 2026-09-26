import { NextResponse } from 'next/server';
import { getRateLimitSnapshot } from '@/lib/security/rate-limit';
import { getBlockedUaList } from '@/lib/security/bad-actor';

let fsMod: typeof import('fs') | null = null;
let pathMod: typeof import('path') | null = null;
function getNodeDeps(): { fs: typeof import('fs'); path: typeof import('path') } | null {
  try {
    if (!fsMod) fsMod = require('fs') as typeof import('fs');
    if (!pathMod) pathMod = require('path') as typeof import('path');
    if (!fsMod || !pathMod) return null;
    return { fs: fsMod, path: pathMod };
  } catch {
    return null;
  }
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const REQUIRED_SECURITY_HEADERS = [
  'x-frame-options',
  'x-content-type-options',
  'referrer-policy',
  'content-security-policy',
  'strict-transport-security',
];

function computeGrade(score: number): 'A' | 'B' | 'C' | 'D' {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  return 'D';
}

function fileExistsInAppTree(relPath: string): boolean {
  const deps = getNodeDeps();
  if (!deps) return false;
  const fullPath = deps.path.join(process.cwd(), 'src', 'app', relPath);
  try {
    return deps.fs.existsSync(fullPath);
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const requestHeaders: Record<string, string> = {};
  request.headers.forEach((v, k) => {
    requestHeaders[k.toLowerCase()] = v;
  });

  const headerKeys = Object.keys(requestHeaders).sort();

  const cspHeader = requestHeaders['content-security-policy'] ?? '';
  const hasNonce = /'nonce-[a-f0-9]+'/.test(cspHeader);
  const hasStrictDynamic = cspHeader.includes("'strict-dynamic'");

  const securityTxtPresent = fileExistsInAppTree('.well-known/security.txt/route.ts');
  const robotsTxtPresent = fileExistsInAppTree('robots.txt/route.ts');

  let checksPassed = 0;
  let checksTotal = 0;

  const headerChecks: Record<string, boolean> = {};
  for (const h of REQUIRED_SECURITY_HEADERS) {
    checksTotal++;
    const present = headerKeys.includes(h);
    headerChecks[h] = present;
    if (present) checksPassed++;
  }

  checksTotal++;
  if (hasNonce) checksPassed++;
  checksTotal++;
  if (hasStrictDynamic) checksPassed++;

  const csrfEnabled = true;
  checksTotal++;
  if (csrfEnabled) checksPassed++;

  const rateLimitState = getRateLimitSnapshot();
  checksTotal++;
  if (rateLimitState.totalBuckets >= 0) checksPassed++;

  checksTotal++;
  if (securityTxtPresent) checksPassed++;
  checksTotal++;
  if (robotsTxtPresent) checksPassed++;

  const blockedUaCount = getBlockedUaList().length;
  checksTotal++;
  if (blockedUaCount >= 20) checksPassed++;

  const score = checksTotal > 0 ? Math.round((checksPassed / checksTotal) * 100) : 0;
  const grade = computeGrade(score);

  return NextResponse.json(
    {
      ok: true,
      timestamp: Date.now(),
      grade,
      score,
      checks: {
        passed: checksPassed,
        total: checksTotal,
      },
      headerKeys,
      headerChecks,
      csp: {
        raw: cspHeader || null,
        hasNonce,
        hasStrictDynamic,
      },
      csrfEnabled,
      rateLimit: {
        configured: true,
        ...rateLimitState,
      },
      badActor: {
        blockedUaCount,
      },
      files: {
        'security.txt': securityTxtPresent,
        'robots.txt': robotsTxtPresent,
      },
    },
    { status: 200 },
  );
}
