import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const VERSION = '3.0.0';

const PROBE_TIMEOUT_MS = 15000;

interface ProbeTarget {
  name: string;
  url: string;
  path?: string;
  fallbackPath?: string;
  label: string;
}

const TARGETS: ProbeTarget[] = [
  { name: 'supply-chain-main', url: 'https://t1trn6kunnv1-d.space-z.ai', path: '/api/healthz', fallbackPath: '/', label: 'Supply Chain Main · 21 tabs' },
  { name: 'hit-swarm', url: 'https://x1he4604ap01-deploy.space-z.ai', path: '/api/healthz', label: 'HIT Swarm · Autonomous Revenue Engine' },
  { name: 'aqcc', url: 'https://b1fx661hzse0-d.space-z.ai', fallbackPath: '/', path: '/api/healthz', label: 'AgentFlow AI Command Center' },
  { name: 'aqcc-backend', url: 'https://agent-flow-ai-9855ea98.base44.app/api', fallbackPath: '/', path: '/api/healthz', label: 'AgentFlow Base44 backend' },
  { name: 'vercel', url: 'https://supply-chain-swarm.vercel.app', path: '/api/healthz', label: 'Supply Chain · Vercel public' },
  { name: 'preview-b', url: 'https://preview-chat-52b995fb-7bc4-47b5-8597-83766cbf7229.space-z.ai', path: '/api/healthz', fallbackPath: '/api/download', label: 'Preview surface B' },
];

interface ProbeResult {
  status: number;
  ok: boolean;
  latencyMs: number;
  title: string | null;
  bodySnippet: string;
  fcErrorType: string | null;
  fcRequestId: string | null;
}

async function probe(target: ProbeTarget): Promise<ProbeResult> {
  const base = target.url.replace(/\/+$/, '');
  const start = Date.now();
  const results: ProbeResult[] = [];
  for (const p of [target.path, target.fallbackPath].filter((x): x is string => !!x)) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
    try {
      const res = await fetch(`${base}${p}`, { signal: ctl.signal, redirect: 'follow', cache: 'no-store' });
      const body = await res.text().catch(() => '');
      const title = /<title[^>]*>([^<]*)<\/title>/i.exec(body)?.[1]?.trim() || null;
      results.push({
        status: res.status,
        ok: res.ok && res.status === 200,
        latencyMs: Date.now() - start,
        title,
        bodySnippet: body.replace(/\s+/g, ' ').slice(0, 160),
        fcErrorType: res.headers.get('x-fc-error-type'),
        fcRequestId: res.headers.get('x-fc-request-id'),
      });
    } catch {
      results.push({
        status: 0,
        ok: false,
        latencyMs: Date.now() - start,
        title: null,
        bodySnippet: '',
        fcErrorType: null,
        fcRequestId: null,
      });
    } finally {
      clearTimeout(to);
    }
    if (results[results.length - 1].ok || results[results.length - 1].status === 503) break;
  }
  const chosen = results[0] || results[results.length - 1];
  return chosen;
}

function diagnose(target: ProbeTarget, r: ProbeResult): { diagnosis: string; perUrlActions: string[] } {
  const zeroBody = r.bodySnippet.trim().length === 0;
  if (r.status === 0) {
    return {
      diagnosis: 'probe failed locally (network / TLS egress blocked) — external re-check required',
      perUrlActions: ['Re-probe from an external WebFetch path before concluding down'],
    };
  }
  if (r.status === 200 && r.title && r.title.toLowerCase() === 'failed') {
    return {
      diagnosis: 'Space-Z platform reports deploy failure (Failed page, likely tar/Prisma/startup)',
      perUrlActions: [
        'Push deploy-fix bundle / fix bundle SHA to GitHub',
        'Trigger Space-Z dashboard redeploy for this instance',
      ],
    };
  }
  if (r.status === 200) {
    return { diagnosis: 'LIVE — healthy', perUrlActions: [] };
  }
  if (r.status === 502 && zeroBody) {
    return {
      diagnosis: 'down — Z.ai expiry-recycle signature (Alibaba FC gateway zero-body 502)',
      perUrlActions: [
        'Trigger Space-Z dashboard redeploy (no SPACEZ_TOKEN in-repo — dashboard action only)',
      ],
    };
  }
  if (r.status === 500 || r.fcErrorType === 'FCCommonError' || (r.title && r.title.toLowerCase() === 'failed')) {
    return {
      diagnosis: 'Space-Z platform deploy failure (X-Fc-Error-Type captured)',
      perUrlActions: ['Trigger Space-Z dashboard redeploy for this instance'],
    };
  }
  if (r.status === 404 && zeroBody) {
    return {
      diagnosis: 'serving but healthz/route missing — stale build without this route',
      perUrlActions: [
        'Compare hosted build against latest green commit',
        'Trigger Space-Z dashboard redeploy after owner reconnects GitHub repo',
      ],
    };
  }
  if (r.status === 403) {
    return { diagnosis: 'gateway blocked 403', perUrlActions: ['Check instance auth / dashboard state'] };
  }
  return {
    diagnosis: `unexpected ${r.status}${r.fcErrorType ? ` (${r.fcErrorType})` : ''}`,
    perUrlActions: ['Investigate platform log for this instance'],
  };
}

const CANONICAL_FILES = [
  'scripts/self-healing-check.mjs',
  'scripts/verify-swarm-invariants.mjs',
  '.github/workflows/deploy-space-z.yml',
  'DEPLOYMENTS.md',
  'src/app/api/deploy/status/route.ts',
];

function existsRel(root: string, f: string): boolean {
  try {
    return fs.existsSync(path.join(root, f));
  } catch {
    return false;
  }
}

function checkBuildArtifacts(): Record<string, boolean> {
  const root = process.cwd();
  return {
    standalone_build: existsRel(root, '.next/standalone'),
    prisma_client_bundled:
      existsRel(root, 'node_modules/@prisma/client') && existsRel(root, 'node_modules/.prisma/client'),
    next_node_modules_removed: !existsRel(root, '.next/server/node_modules'),
    tarball:
      existsRel(root, 'out.tar.gz') ||
      existsRel(root, 'deploy-fix.bundle') ||
      existsRel(root, 'download/deploy-fix.bundle'),
    manifest: existsRel(root, '.next/BUILD_ID'),
  };
}

function checkSelfHealing(): { file: string; present: boolean }[] {
  const root = process.cwd();
  return CANONICAL_FILES.map((f) => ({ file: f, present: existsRel(root, f) }));
}

async function gitSync() {
  const run = async (args: string[]): Promise<string | null> => {
    try {
      const { stdout } = await execFileAsync('git', args, { timeout: 10000 });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  };
  const localHead = await run(['rev-parse', '--short', 'HEAD']);
  const localBranch = await run(['rev-parse', '--abbrev-ref', 'HEAD']);
  const upstream = await run(['rev-parse', '--abbrev-ref', '@{upstream}']);
  let originHead: string | null = null;
  let ahead = 0;
  let behind = 0;
  let dirty = 0;
  if (upstream) {
    const remoteName = upstream.split('/')[0];
    originHead = await run(['rev-parse', '--short', `${remoteName}/main`]);
    const lr = await run(['rev-list', '--left-right', '--count', `HEAD...${upstream}`]);
    if (lr) {
      const [a, b] = lr.split(/\s+/).map(Number);
      ahead = a || 0;
      behind = b || 0;
    }
  }
  const dirtyOut = await run(['status', '--porcelain']);
  if (dirtyOut) dirty = dirtyOut.split(/\r?\n/).filter((l) => l.trim().length > 0).length;

  const clean = dirty === 0 && behind === 0 && (!localHead || !originHead || localHead === originHead);
  return {
    local_branch: localBranch,
    upstream: upstream || null,
    local_head: localHead,
    origin_head: originHead,
    ahead,
    behind,
    dirty_files: dirty,
    status: clean ? 'synced' : 'diverged',
  };
}

async function safeCount(modelName: string): Promise<number> {
  try {
    const model = (db as unknown as Record<string, unknown>)[modelName];
    if (!model || typeof (model as { count?: unknown }).count !== 'function') return -1;
    const n = await (model as { count: () => Promise<number> }).count();
    return Number.isFinite(n) ? n : -1;
  } catch {
    return -1;
  }
}

export async function GET() {
  const [probed, build, git] = await Promise.all([
    Promise.all(TARGETS.map(async (t) => ({ target: t, result: await probe(t) }))),
    Promise.resolve(checkBuildArtifacts()),
    gitSync(),
  ]);

  const urls = probed.map(({ target, result }) => {
    const { diagnosis, perUrlActions } = diagnose(target, result);
    return {
      name: target.name,
      url: `${target.url.replace(/\/+$/, '')}${target.path || ''}`,
      label: target.label,
      status: result.status,
      ok: result.ok,
      latency_ms: result.latencyMs,
      title: result.title,
      body_snippet: result.bodySnippet,
      fc: {
        error_type: result.fcErrorType,
        request_id: result.fcRequestId,
      },
      diagnosis,
      next_actions: perUrlActions,
    };
  });

  const down = urls.filter((u) => !u.ok);
  const healthy = urls.filter((u) => u.ok);

  const perUrlActions = down.flatMap((u) => u.next_actions);
  const nextActions = [...new Set(perUrlActions)];

  const dbCounts = {
    revenue_event_count: await safeCount('revenueEvent'),
    payout_batch_count: await safeCount('payoutBatch'),
    payout_item_count: await safeCount('payoutItem'),
    payout_count: await safeCount('payout'),
    owner_account_count: await safeCount('ownerAccount'),
    owner_payable_account_legacy: await safeCount('ownerPayableAccount'),
    ledger_account_count: await safeCount('ledgerAccount'),
    revenue_ledger_entry_count: await safeCount('revenueLedgerEntry'),
    procurement_item_count: await safeCount('procurementItem'),
    supplier_count: await safeCount('supplier'),
    shipment_count: await safeCount('shipment'),
    purchase_order_count: await safeCount('purchaseOrder'),
  };
  const dbUnavailable = dbCounts.owner_account_count === -1 && dbCounts.ledger_account_count === -1;
  const dbStatus = { counts: dbCounts, error: dbUnavailable };

  const selfHealing = checkSelfHealing();
  const selfHealingMissing = selfHealing.filter((s) => !s.present);
  const selfHealingWired = selfHealingMissing.length === 0;

  const gitOk = git.status === 'synced';

  const buildArtifactsIncomplete =
    !build.standalone_build || !build.manifest || !build.prisma_client_bundled;

  const overallFailing = down.length > 0 || dbUnavailable || buildArtifactsIncomplete || !gitOk;

  const summary = {
    instances_up: healthy.length,
    instances_down: down.length,
    build_artifacts_incomplete: buildArtifactsIncomplete,
    git_synced: gitOk,
    database_ok: !dbUnavailable,
    ok: !overallFailing,
  };

  return NextResponse.json({
    ok: summary.ok,
    timestamp: Date.now(),
    version: VERSION,
    status: summary.ok ? 'healthy' : 'degraded',
    healthz: {
      ok: true,
      timestamp: Date.now(),
      uptime: process.uptime(),
      version: VERSION,
      status: 'healthy',
    },
    surfaces: { urls, summary },
    build_artifacts: build,
    git_sync: git,
    db: dbStatus,
    self_healing: { wired: selfHealingWired, items: selfHealing },
    next_actions: nextActions,
    so: 'deploy/status enhanced v2 — ported from Space-Z container route + richer diagnostics',
  });
}