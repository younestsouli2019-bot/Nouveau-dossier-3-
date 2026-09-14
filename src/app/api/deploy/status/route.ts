import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import fs from 'node:fs';
import path from 'node:path';

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

function checkSelfHealing(): { file: string; present: boolean }[] {
  const root = process.cwd();
  return CANONICAL_FILES.map((f) => {
    let present = false;
    try {
      present = fs.existsSync(path.join(root, f));
    } catch {
      present = false;
    }
    return { file: f, present };
  });
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
  const probed = await Promise.all(TARGETS.map(async (t) => ({ target: t, result: await probe(t) })));

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

  const nextActions = [...new Set(down.flatMap((u) => u.next_actions))];

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

  const selfHealing = checkSelfHealing();
  const missingSelfHealing = selfHealing.filter((s) => !s.present).length;

  const summary = {
    total: urls.length,
    up: healthy.length,
    down: down.length,
    ok: down.length === 0,
    degraded: missingSelfHealing > 0,
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
    summary,
    urls,
    next_actions: nextActions,
    db: dbCounts,
    self_healing: selfHealing,
    so: 'deploy/status enhanced — ported from Space-Z container route',
  });
}