import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { timingSafeEqual, createHash } from 'node:crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface DeployStatusRecord {
  instance: string;
  commit: string;
  status: string;
  health_ok: boolean;
  latency_ms: number;
  fc_error_type?: string;
  error_message?: string;
  recorded_at: number;
}

interface DeployStatusCache {
  [instance: string]: DeployStatusRecord;
}

const CACHE_FILE = 'deploy-status-cache.json';

function getCachePath(): string {
  return path.join(process.cwd(), 'data', CACHE_FILE);
}

function ensureDataDir(): void {
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function readCache(): DeployStatusCache {
  try {
    const cachePath = getCachePath();
    if (!fs.existsSync(cachePath)) {
      return {};
    }
    const raw = fs.readFileSync(cachePath, 'utf8');
    return JSON.parse(raw) as DeployStatusCache;
  } catch {
    return {};
  }
}

function writeCache(cache: DeployStatusCache): void {
  ensureDataDir();
  const cachePath = getCachePath();
  const raw = JSON.stringify(cache, null, 2);
  fs.writeFileSync(cachePath, raw, 'utf8');
}

interface PutBody {
  instance?: unknown;
  commit?: unknown;
  status?: unknown;
  health_ok?: unknown;
  latency_ms?: unknown;
  fc_error_type?: unknown;
  error_message?: unknown;
}

function to256(v: string): Buffer {
  return createHash('sha256').update(v).digest();
}
function constantTimeEq(a: string, b: string): boolean {
  if (!a || !b) return false;
  try {
    return timingSafeEqual(to256(a), to256(b));
  } catch {
    return false;
  }
}

export async function PUT(request: Request) {
  //
  // FAIL-CLOSED bearer-token auth gate. Matches header
  // `x-deploy-record-token: Bearer <DEPLOY_RECORD_TOKEN>
  //
  // Set DEPLOY_RECORD_TOKEN from GitHub repo secrets → runtime env.
  // Local dev bypass: NODE_ENV !== 'production' AND token both empty — allows localhost dev
  // (so local put-deploy-smoke script can test without provisioning secrets yet).
  // Production FAIL-CLOSED: if NODE_ENV=production MUST have both sides populated.
  //
  const reqTokRaw = request.headers.get('x-deploy-record-token') || '';
  const reqTok = reqTokRaw.startsWith('Bearer ') ? reqTokRaw.slice('Bearer '.length) : reqTokRaw;
  const cfgTok = process.env.DEPLOY_RECORD_TOKEN || process.env.DEPLOY_HOOK_TOKEN || process.env.GITHUB_WEBHOOK_SECRET || '';
  const isProd = process.env.NODE_ENV === 'production';
  const bypassOk = !isProd && !reqTok && !cfgTok;
  const tokOk = constantTimeEq(reqTok, cfgTok);
  if (bypassOk || tokOk) {
    // ok
  } else {
    return NextResponse.json(
      {
        ok: false,
        error: 'Unauthorized: deploy record requires x-deploy-record-token: Bearer <DEPLOY_RECORD_TOKEN> header.',
      },
      { status: 401 },
    );
  }

  let body: PutBody;
  try {
    body = (await request.json()) as PutBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const instance = typeof body.instance === 'string' ? body.instance.trim() : '';
  const commit = typeof body.commit === 'string' ? body.commit.trim() : '';
  const status = typeof body.status === 'string' ? body.status.trim() : '';
  const health_ok = typeof body.health_ok === 'boolean' ? body.health_ok : false;
  const latency_ms = typeof body.latency_ms === 'number' ? body.latency_ms : 0;
  const fc_error_type = typeof body.fc_error_type === 'string' ? body.fc_error_type : undefined;
  const error_message = typeof body.error_message === 'string' ? body.error_message : undefined;

  if (!instance) {
    return NextResponse.json({ ok: false, error: 'Missing required field: instance' }, { status: 400 });
  }
  if (!commit) {
    return NextResponse.json({ ok: false, error: 'Missing required field: commit' }, { status: 400 });
  }
  if (!status) {
    return NextResponse.json({ ok: false, error: 'Missing required field: status' }, { status: 400 });
  }

  const record: DeployStatusRecord = {
    instance,
    commit,
    status,
    health_ok,
    latency_ms,
    ...(fc_error_type !== undefined ? { fc_error_type } : {}),
    ...(error_message !== undefined ? { error_message } : {}),
    recorded_at: Date.now(),
  };

  const cache = readCache();
  cache[instance] = record;
  writeCache(cache);

  return NextResponse.json(
    {
      ok: true,
      recorded: record,
      instances: Object.keys(cache),
    },
    { status: 200 },
  );
}
