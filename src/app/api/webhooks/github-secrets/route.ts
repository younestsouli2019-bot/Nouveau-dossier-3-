import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import { prisma } from '@/lib/db';
import { sha256 } from '@/lib/strict-enforcement/crypto-utils';

import { activateKey } from '@/lib/connector-credentials';

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || '';

const KNOWN_SECRET_CONNECTORS: Record<string, string> = {
  LIVE_BANK_API: 'attijariwafa',
  ATTIJARI_CLIENT_ID: 'attijariwafa',
  ATTIJARI_CLIENT_SECRET: 'attijariwafa',
  ATTIJARI_SCOPE: 'attijariwafa',
  ATTIJARI_API_BASE_URL: 'attijariwafa',
  ATTIJARI_PSD2_BASE_URL: 'attijariwafa',
  OPENROUTER_API_KEY: 'base44',
  ZAI_API_KEY: 'base44',
  BASE44_API_KEY: 'base44',
  PAYPAL_CLIENT_ID: 'paypal',
  PAYPAL_CLIENT_SECRET: 'paypal',
};

function verifyHMAC(payload: string, signature: string): boolean {
  if (!WEBHOOK_SECRET) return true;
  const expected = createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex');
  return `sha256=${expected}` === signature;
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
          entryHash: await sha256(`github-secrets:rejected:${Date.now()}`),
          performedBy: source,
          discrepancyNote: 'HMAC signature mismatch',
        },
      });
    return NextResponse.json({ error: 'Invalid HMAC signature' }, { status: 401 });
    }

    const payload = JSON.parse(rawBody);
    const { secrets, repo, timestamp } = payload;

    const received: string[] = [];
    for (const [key, val] of Object.entries(secrets || {})) {
      if (val && typeof val === 'string' && val.length > 0) {
        received.push(key);
      }
    }

    const proofHash = await sha256(JSON.stringify({
      repo, source, timestamp, received, ts: Date.now(),
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
          receivedKeys: received.map(k => k.slice(0, 4) + '***'),
        }),
      },
    });

        // Activate keys for known connectors
    for (const secretKey of received) {
      const connectorId = KNOWN_SECRET_CONNECTORS[secretKey];
      if (connectorId) {
        activateKey(connectorId, secretKey);
      }
    }

    return NextResponse.json({
      status: 'synced',
      synced: received.length,
      keys: received,
      repo,
      timestamp,
    });
  } catch (err: unknown) {
    console.error('[Webhook/GitHubSecrets] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET() {
    return NextResponse.json({ status: 'active', endpoint: 'github-secrets' });
}