import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { prisma } from '@/lib/db';
import { sha256 } from '@/lib/strict-enforcement/crypto-utils';

// GitHub App webhook secret — set via env, never hardcoded/committed.
const WEBHOOK_SECRET =
  process.env.GITHUB_APP_WEBHOOK_SECRET || process.env.GITHUB_WEBHOOK_SECRET || '';

const DEPLOY_HOOK_URL = process.env.SPACEZ_DEPLOY_HOOK || '';
const DEPLOY_RECORD_TOKEN = process.env.DEPLOY_RECORD_TOKEN || '';
const MAIN_APP_URL = process.env.SPACEZ_MAIN_APP_URL || '';

// Events we can act on. Everything else is acknowledged but not processed.
const HANDLED_EVENTS = new Set([
  'ping',
  'repository',
  'push',
  'pull_request',
  'check_run',
  'check_suite',
  'deployment',
  'deployment_status',
  'workflow_run',
  'installation',
  'installation_repositories',
]);

function safeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function verifyHMAC(payload: string, signature: string): boolean {
  if (!WEBHOOK_SECRET) return false;
  if (!/^sha256=([0-9a-f]{64})$/i.test(signature)) return false;
  const expected = createHmac('sha256', WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  const receivedBuf = Buffer.from(signature.slice('sha256='.length), 'hex');
  return safeEqual(expectedBuf, receivedBuf);
}

async function recordEvent(opts: {
  event: string;
  action?: string;
  repo?: string;
  actor?: string;
  entityId: string;
  meta?: Record<string, unknown>;
}) {
  const hash = await sha256(
    JSON.stringify({ ...opts, ts: Date.now(), nonce: Math.random().toString(36).slice(2) }),
  );
  try {
    await prisma.auditLedger.create({
      data: {
        entityType: 'github_app_webhook',
        entityId: hash.slice(0, 16),
        action: `${opts.event}${opts.action ? ':' + opts.action : ''}`,
        entryHash: hash,
        performedBy: opts.actor || opts.repo || 'github-app',
        metadata: JSON.stringify({
          event: opts.event,
          action: opts.action,
          repo: opts.repo,
          actor: opts.actor ? opts.actor.toLowerCase() : undefined,
          ...opts.meta,
        }),
      },
    });
  } catch (e) { /* ignore prisma errors */ }
}

async function collectTreasurySnapshot() {
  try {
    const ownerRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COALESCE(SUM("totalReceived"::float),0)::float AS tr, COALESCE(SUM("totalSent"::float),0)::float AS ts,
              COALESCE(SUM("heldBalance"::float),0)::float AS held, COALESCE(SUM("spendableBalance"::float),0)::float AS spend,
              COUNT(*)::int AS n FROM "OwnerAccount";`
    ).catch(() => []);
    const r = (ownerRows as any)[0] || {};
    const osComp = await prisma.ownerSettlement.count({ where: { status: 'completed' } }).catch(() => 0);
    const piComp = await prisma.payoutItem.count({ where: { status: 'completed' } }).catch(() => 0);
    const poDeliv = await prisma.purchaseOrder.count({ where: { status: { in: ['delivered', 'receipt_confirmed', 'settled'] as any } } }).catch(() => 0);
    const poSumRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COALESCE(SUM("totalAmount"::float),0)::float AS total FROM "PurchaseOrder" WHERE status::text IN ('delivered','receipt_confirmed','settled');`
    ).catch(() => [] as any);
    const rwcSale = await prisma.auditLedger.count({ where: { action: 'rwc_sale_received' } }).catch(() => 0);
    return {
      ownerAccount: { totalReceived: Number(r.tr || 0), totalSent: Number(r.ts || 0), heldBalance: Number(r.held || 0), spendableBalance: Number(r.spend || 0), n: Number(r.n || 0) },
      settlements: { completed: Number(osComp || 0) },
      payoutItems: { completed: Number(piComp || 0) },
      purchaseOrders: { deliveredOrSettled: Number(poDeliv || 0), totalDeliveredValue: Number((poSumRows as any)[0]?.total || 0) },
      realWorldCerts: { receivedAuditRows: Number(rwcSale || 0) },
    };
  } catch (e) { return { error: (e as any).message }; }
}

async function triggerSpaceZDeployHook(commitSha?: string) {
  if (!DEPLOY_HOOK_URL) return { skipped: true, reason: 'SPACEZ_DEPLOY_HOOK env missing' };
  try {
    const finalUrl = commitSha ? `${DEPLOY_HOOK_URL}${DEPLOY_HOOK_URL.includes('?') ? '&' : '?'}commit=${encodeURIComponent(commitSha)}` : DEPLOY_HOOK_URL;
    const r = await fetch(finalUrl, { method: 'GET', headers: { 'User-Agent': 'swarm-deploy-webhook/1.0' } });
    const txt = await r.text().catch(() => '');
    return { ok: r.ok, httpStatus: r.status, body: txt.slice(0, 500) };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

async function putDeployRecord(instance: string, commit: string, status: string, meta: any = {}) {
  if (!MAIN_APP_URL) return { skipped: true, reason: 'SPACEZ_MAIN_APP_URL env missing' };
  try {
    const snap = await collectTreasurySnapshot();
    const body = JSON.stringify({ instance, commit, status, health_ok: true, latency_ms: 0, timestamp: new Date().toISOString(), treasury: snap, ...meta });
    const hdrs: Record<string, string> = { 'Content-Type': 'application/json' };
    if (DEPLOY_RECORD_TOKEN) hdrs['x-deploy-record-token'] = `Bearer ${DEPLOY_RECORD_TOKEN}`;
    const r = await fetch(`${MAIN_APP_URL.replace(/\/+$/, '')}/api/deploy/status/record`, { method: 'PUT', headers: hdrs, body });
    return { ok: r.ok, httpStatus: r.status, body: (await r.text().catch(() => '')).slice(0, 400), treasuryIncluded: !!snap && !(snap as any).error };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-hub-signature-256') || '';
  const event = req.headers.get('x-github-event') || '';
  const delimiter = req.headers.get('x-github-delivery') || 'unknown';
  const source = req.headers.get('x-source') || 'github-app';

  // Verify authenticity before trusting the payload.
  if (WEBHOOK_SECRET && !verifyHMAC(rawBody, signature)) {
    try {
      await prisma.auditLedger.create({
        data: {
          entityType: 'github_app_webhook',
          entityId: 'rejected',
          action: 'hmac_verification_failed',
          entryHash: await sha256(`github-app:rejected:${Date.now()}`),
          performedBy: source,
          discrepancyNote: 'GitHub App HMAC signature mismatch',
        },
      });
    } catch (e) { /* ignore */ }
    return NextResponse.json({ error: 'Invalid HMAC signature' }, { status: 401 });
  }

  let payload: any = {};
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const repo = payload.repository?.full_name || payload.installation?.account?.login || '';
  const actor =
    payload.sender?.login ||
    payload.installation?.account?.login ||
    payload.repository?.owner?.login ||
    '';
  const commitSha = (event === 'push' && Array.isArray(payload.commits) && payload.commits.length > 0)
    ? (payload.after || payload.head_commit?.id || '').slice(0, 12)
    : (payload.check_run?.head_sha || payload.deployment?.sha || payload.workflow_run?.head_sha || '').slice(0, 12);

  if (event === 'ping') {
    await recordEvent({ event, entityId: delimiter, repo, actor, meta: { pong: true } });
    return NextResponse.json({ status: 'pong', event, repo, actor });
  }

  if (!HANDLED_EVENTS.has(event)) {
    // Acknowledge unhandled events so GitHub doesn't retry; no ledger spam.
    return NextResponse.json({ status: 'ignored', event });
  }

  const action = payload.action || payload.check_run?.status || undefined;

  // ---- NEW ZDEPLOY COORDINATION HOOKS ----
  let deployHook: any = { skipped: true, reason: 'not push/deploy event' };
  let record: any = { skipped: true, reason: 'not push/deploy event' };
  const shouldTrigger = (event === 'push' && (payload.ref === 'refs/heads/main' || payload.ref === 'refs/heads/master'))
    || event === 'deployment'
    || event === 'workflow_run' && payload.action === 'completed' && payload.workflow_run?.conclusion === 'success' && payload.workflow_run?.head_branch === 'main';

  if (shouldTrigger) {
    deployHook = await triggerSpaceZDeployHook(commitSha || undefined);
    // Fire deploy record AFTER deploy hook (non-blocking; failure not fatal)
    record = await putDeployRecord('main-app', commitSha || payload.head_commit?.id || payload.after || 'unknown', 'deploying', {
      event,
      action,
      repo,
      actor,
      deployHook,
    });
  }

  await recordEvent({
    event,
    action,
    repo,
    actor,
    entityId: delimiter,
    meta: {
      delivered: delimiter,
      commit: commitSha || undefined,
      deployHook,
      record,
      ref: payload.ref,
    },
  });

  return NextResponse.json({
    status: 'processed',
    event,
    action,
    repo,
    actor,
    commit: commitSha || undefined,
    deployHook: deployHook && !(deployHook as any).skipped ? deployHook : undefined,
    record: record && !(record as any).skipped ? record : undefined,
  });
}

export async function GET() {
  const snap = await collectTreasurySnapshot();
  return NextResponse.json({
    status: 'active',
    endpoint: 'POST /api/webhook/deploy',
    handledEvents: Array.from(HANDLED_EVENTS),
    verification: 'X-Hub-Signature-256 (HMAC-SHA256, GITHUB_APP_WEBHOOK_SECRET)',
    coordination: {
      deployHookConfigured: !!DEPLOY_HOOK_URL,
      recordEndpointConfigured: !!MAIN_APP_URL,
      authorizedPutRecord: !!DEPLOY_RECORD_TOKEN,
    },
    treasurySnapshot: snap,
  });
}
