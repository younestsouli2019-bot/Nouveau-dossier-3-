import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { prisma } from '@/lib/db';
import { sha256 } from '@/lib/strict-enforcement/crypto-utils';

/**
 * GitHub App deploy / repository events webhook.
 *
 * 🚧 FAIL-CLOSED (P7):
 *   - GITHUB_APP_WEBHOOK_SECRET OU GITHUB_WEBHOOK_SECRET DOIT être défini.
 *   - Absence → 401 immédiat.
 *   - HMAC x-hub-signature-256 obligatoire, timingSafeEqual.
 */
const WEBHOOK_SECRET =
  process.env.GITHUB_APP_WEBHOOK_SECRET || process.env.GITHUB_WEBHOOK_SECRET;

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
  try { return timingSafeEqual(a, b); } catch { return false; }
}

/**
 * FAIL-CLOSED verify:
 *   - Si WEBHOOK_SECRET undefined → return false.
 *   - Format signature obligatoire sha256=64hexa.
 *   - Compare timingSafeEqual buffers (contre timing attack).
 */
function verifyHMAC(payload: string, signature: string): boolean {
  if (!WEBHOOK_SECRET) return false;                       // P7: FAIL-CLOSED
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
}

export async function POST(req: NextRequest) {
  // P7 GATE FAIL-CLOSED: secret doit être présent (tester AVANT read body)
  if (!WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: 'Deploy webhook secret not configured — fail-closed 401 (GITHUB_APP_WEBHOOK_SECRET || GITHUB_WEBHOOK_SECRET env required)' },
      { status: 401 }
    );
  }

  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return NextResponse.json({ error: 'Unreadable body' }, { status: 400 });
  }
  const signature = req.headers.get('x-hub-signature-256') || '';
  const event = req.headers.get('x-github-event') || '';
  const delimiter = req.headers.get('x-github-delivery') || 'unknown';
  const source = req.headers.get('x-source') || 'github-app';

  // P7: gate FAIL-CLOSED (double)
  if (!verifyHMAC(rawBody, signature)) {
    try {
      await prisma.auditLedger.create({
        data: {
          entityType: 'github_app_webhook',
          entityId: 'rejected',
          action: 'hmac_verification_failed',
          entryHash: await sha256(`github-app:rejected:${Date.now()}`),
          performedBy: source,
          discrepancyNote: 'Deploy webhook HMAC mismatch or missing env (P7 fail-closed gate)',
        },
      });
    } catch { /* DB non dispo sur rejet = OK. 401 reste garanti. */ }
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

  if (event === 'ping') {
    await recordEvent({ event, entityId: delimiter, repo, actor, meta: { pong: true } });
    return NextResponse.json({ status: 'pong', event, repo, actor });
  }

  if (!HANDLED_EVENTS.has(event)) {
    // Acknowledge unhandled events so GitHub doesn't retry; no ledger spam.
    return NextResponse.json({ status: 'ignored', event });
  }

  const action = payload.action || payload.check_run?.status || undefined;

  await recordEvent({
    event,
    action,
    repo,
    actor,
    entityId: delimiter,
    meta: { delivered: delimiter },
  });

  return NextResponse.json({ status: 'processed', event, action, repo, actor });
}

export async function GET() {
  return NextResponse.json({
    status: 'active',
    endpoint: 'POST /api/webhook/deploy',
    handledEvents: Array.from(HANDLED_EVENTS),
    verification:
      'X-Hub-Signature-256 HMAC-SHA256, timingSafeEqual compare, FAIL-CLOSED if secret env missing.',
  });
}
