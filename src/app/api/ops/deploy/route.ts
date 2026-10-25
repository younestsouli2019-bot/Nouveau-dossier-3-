import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/ops/deploy — triggers the "Deploy to Space-Z" GitHub Actions workflow.
 * GET  /api/ops/deploy — returns health of all deployment targets + latest run status.
 *
 * Auth: x-ops-secret header must match OPS_API_SECRET when set (fail-closed otherwise
 * only when the secret is present — local preview has none).
 */

const GH_TOKEN = process.env.DEPLOY_GH_TOKEN || '';
const REPO = 'younestsouli2019-bot/Nouveau-dossier-3-';
const WORKFLOW_ID = 339266790; // deploy-space-z.yml

const TARGETS: Array<{ key: string; name: string; url: string; fatal: boolean }> = [
  { key: 'vercel', name: 'Vercel (Primary Live)', url: 'https://supply-chain-swarm.vercel.app', fatal: true },
  { key: 'main_app', name: 'Space-Z MAIN_APP', url: 'https://t1trn6kunnv1-d.space-z.ai', fatal: true },
  { key: 'hit_swarm', name: 'Space-Z HIT_SWARM', url: 'https://x1he4604ap01-deploy.space-z.ai', fatal: false },
  { key: 'payout_recovery', name: 'Space-Z PAYOUT_RECOVERY', url: 'https://z1jw2305dfr0-d.space-z.ai', fatal: false },
  { key: 'trace_platform', name: 'Space-Z TRACE_PLATFORM', url: 'https://b1fx661hzse0-d.space-z.ai', fatal: false },
  { key: 'preview_b', name: 'Space-Z PREVIEW_B (this bot)', url: 'https://preview-chat-52b995fb-7bc4-47b5-8597-83766cbf7229.space-z.ai', fatal: false },
];

async function probe(url: string): Promise<{ code: number; ok: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(8000), cache: 'no-store' });
    return { code: res.status, ok: res.status >= 200 && res.status < 400, latencyMs: Date.now() - start };
  } catch {
    return { code: 0, ok: false, latencyMs: Date.now() - start };
  }
}

async function gh(path: string, init?: RequestInit) {
  if (!GH_TOKEN) throw new Error('DEPLOY_GH_TOKEN not configured');
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${GH_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'hit-swarm-deploy-panel',
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  });
}

export async function GET() {
  // Probe all targets in parallel
  const probes = await Promise.all(
    TARGETS.map(async (t) => ({ ...t, ...(await probe(t.url)) }))
  );

  // Latest workflow run (if token present)
  let latestRun: { id: number; status: string; conclusion: string; createdAt: string; message: string } | null = null;
  let tokenConfigured = Boolean(GH_TOKEN);
  if (tokenConfigured) {
    try {
      const r = await gh(`/repos/${REPO}/actions/workflows/${WORKFLOW_ID}/runs?per_page=1`);
      if (r.ok) {
        const j = await r.json();
        const run = j.workflow_runs?.[0];
        if (run) {
          latestRun = {
            id: run.id,
            status: run.status,
            conclusion: run.conclusion || 'pending',
            createdAt: run.created_at,
            message: (run.head_commit?.message || '').slice(0, 100),
          };
        }
      } else if (r.status === 401) {
        tokenConfigured = false;
      }
    } catch { /* keep null */ }
  }

  return NextResponse.json({
    targets: probes,
    latestRun,
    tokenConfigured,
    repo: REPO,
    checkedAt: new Date().toISOString(),
  });
}

export async function POST(req: NextRequest) {
  // Optional ops secret gate
  const opsSecret = process.env.OPS_API_SECRET;
  if (opsSecret && req.headers.get('x-ops-secret') !== opsSecret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!GH_TOKEN) {
    return NextResponse.json(
      { error: 'DEPLOY_GH_TOKEN not configured — set it in the environment to enable the deploy button' },
      { status: 503 }
    );
  }

  // Trigger workflow_dispatch on main
  try {
    const r = await gh(`/repos/${REPO}/actions/workflows/${WORKFLOW_ID}/dispatches`, {
      method: 'POST',
      body: JSON.stringify({ ref: 'main' }),
    });

    if (r.status === 204) {
      // Find the run we just created (dispatches create a run within a second or two)
      let runId: number | null = null;
      for (let i = 0; i < 5 && !runId; i++) {
        await new Promise((res) => setTimeout(res, 1500));
        try {
          const rr = await gh(`/repos/${REPO}/actions/workflows/${WORKFLOW_ID}/runs?per_page=1`);
          if (rr.ok) {
            const j = await rr.json();
            const run = j.workflow_runs?.[0];
            if (run && Date.now() - new Date(run.created_at).getTime() < 30000) {
              runId = run.id;
            }
          }
        } catch { /* retry */ }
      }

      return NextResponse.json({
        ok: true,
        dispatched: true,
        runId,
        message: 'Deploy workflow dispatched on main. Build-verify runs first (~2 min), then trigger-deploy + smoke tests.',
        watchUrl: `https://github.com/${REPO}/actions`,
      });
    }

    const body = await r.json().catch(() => ({}));
    return NextResponse.json(
      { error: `GitHub API ${r.status}`, detail: body.message || 'unknown', dispatched: false },
      { status: 502 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: 'dispatch failed', detail: e instanceof Error ? e.message : String(e), dispatched: false },
      { status: 500 }
    );
  }
}
