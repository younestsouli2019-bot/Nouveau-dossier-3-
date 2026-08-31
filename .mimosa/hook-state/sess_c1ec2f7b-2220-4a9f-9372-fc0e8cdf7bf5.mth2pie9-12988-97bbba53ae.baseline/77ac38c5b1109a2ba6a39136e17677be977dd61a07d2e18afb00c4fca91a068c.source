import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import { prisma } from '@/lib/db';
import { sha256 } from '@/lib/strict-enforcement/crypto-utils';

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || '';
const VALID_SECRETS = ['OPENROUTER_API_KEY', 'ZAI_API_KEY', 'GITHUB_PAT'];

interface SecretSyncPayload {
  timestamp: string;
  source: string;
  repo: string;
  secrets: Record<string, string>;
  force?: string;
}

function verifyHMAC(payload: string, signature: string): boolean {
  if (!WEBHOOK_SECRET) return false;
  const expected = createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex');
  return `sha256=${expected}` === signature;
}

function maskValue(val: string): string {
  if (!val || val.length < 8) return '***';
  return val.slice(0, 4) + '***' + val.slice(-4);
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-hub-signature-256') || '';
    const source = req.headers.get('x-source') || 'unknown';

    if (WEBHOOK_SECRET && !verifyHMAC(rawBody, signature)) {
      await prisma.auditLedger.create({
        data: {
          entityType: 'secrets_sync',
          entityId: 'rejected',
          action: 'hmac_verification_failed',
          entryHash: await sha256(`secrets-sync:rejected:${Date.now()}`),
          performedBy: source,
          discrepancyNote: 'HMAC signature mismatch or missing',
        },
      });
      return NextResponse.json({ error: 'Invalid HMAC signature' }, { status: 401 });
    }

    const payload: SecretSyncPayload = JSON.parse(rawBody);
    const { secrets, repo, timestamp, force } = payload;

    if (!secrets || typeof secrets !== 'object') {
      return NextResponse.json({ error: 'Missing secrets object' }, { status: 400 });
    }

    const received: string[] = [];
    const missing: string[] = [];

    for (const key of VALID_SECRETS) {
      const val = secrets[key];
      if (val && val.length > 0) {
        received.push(key);
      } else {
        missing.push(key);
      }
    }

    const proofHash = await sha256(JSON.stringify({
      repo,
      source,
      timestamp,
      received,
      missing,
      ts: Date.now(),
    }));

    await prisma.auditLedger.create({
      data: {
        entityType: 'secrets_sync',
        entityId: proofHash.slice(0, 16),
        action: 'secrets_received',
        entryHash: proofHash,
        performedBy: source,
        metadata: JSON.stringify({
          repo,
          receivedKeys: received.map(maskValue),
          missingKeys: missing,
          force: force === 'true',
        }),
      },
    });

    if (missing.length === VALID_SECRETS.length) {
      return NextResponse.json({
        status: 'no_secrets',
        message: 'All secrets empty — check GitHub repo secrets are set',
        missing,
      }, { status: 200 });
    }

    return NextResponse.json({
      status: 'synced',
      received,
      missing,
      repo,
      timestamp,
    });
  } catch (err: unknown) {
    console.error('[Webhook/SecretsSync] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'active',
    endpoint: 'POST /api/webhooks/secrets-sync',
    requiredHeaders: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': 'sha256=<hmac-signature>',
      'X-Source': 'github-actions',
    },
    validSecrets: VALID_SECRETS,
  });
}
