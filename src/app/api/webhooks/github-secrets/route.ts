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
  ATTIJARI_CIB_LOGIN_URL: 'attijariwafa',
  ATTIJARI_CIB_USER: 'attijariwafa',
  ATTIJARI_CIB_PASS: 'attijariwafa',
  ATTIJARI_CIB_SEL_USER: 'attijariwafa',
  ATTIJARI_CIB_SEL_PASS: 'attijariwafa',
  ATTIJARI_CIB_SEL_LOGIN: 'attijariwafa',
  ATTIJARI_CIB_SEL_ACCT: 'attijariwafa',
  ATTIJARI_CIB_SEL_STMT: 'attijariwafa',
  ATTIJARI_CIB_SEL_DL: 'attijariwafa',
  ATTIJARI_CIB_SEL_FROM: 'attijariwafa',
  ATTIJARI_CIB_SEL_TO: 'attijariwafa',
  ATTIJARI_QWAC_CERT_PATH: 'attijariwafa',
  ATTIJARI_QWAC_KEY_PATH: 'attijariwafa',
  BASE44_APP_ID: 'base44',
  BASE44_SERVICE_TOKEN: 'base44',
  BASE44_API_KEY: 'base44',
  OPENROUTER_API_KEY: 'base44',
  ZAI_API_KEY: 'base44',
  SPACEZ_DEPLOY_HOOK: 'deploy',
  GITHUB_WEBHOOK_SECRET: 'deploy',
  GITHUB_APP_WEBHOOK_SECRET: 'deploy',
  DEPLOY_WEBHOOK_SECRET: 'deploy',
  DEPLOY_RECORD_TOKEN: 'deploy',
  DEPLOY_HOOK_TOKEN: 'deploy',
  SPACEZ_MAIN_APP_URL: 'deploy',
  SPACEZ_HIT_SWARM_URL: 'deploy',
  SPACEZ_PAYOUT_RECOVERY_URL: 'deploy',
  SPACEZ_TRACE_PLATFORM_URL: 'deploy',
  SPACEZ_AGENTFLOW_URL: 'deploy',
  SPACEZ_PREVIEW_B_URL: 'deploy',
  PAYPAL_CLIENT_ID: 'paypal',
  PAYPAL_CLIENT_SECRET: 'paypal',
  PAYPAL_WEBHOOK_ID: 'paypal',
  SWARM_LIVE: 'paypal',
  PAYPAL_PPP2_APPROVED: 'paypal',
  PAYPAL_PPP2_ENABLE_SEND: 'paypal',
  BANK_RAIL_API_KEY: 'bank',
  BANK_RAIL_ACCOUNT_ID: 'bank',
  SWARM_LIVE_BANK: 'bank',
  CRYPTO_SIGNING_POLICY: 'crypto',
  CRYPTO_HOT_WALLET_REF: 'crypto',
  SWARM_LIVE_CRYPTO: 'crypto',
  PAYOUT_TICK_SECRET: 'tick_ops',
  OPS_API_SECRET: 'tick_ops',
  CRON_SECRET: 'tick_ops',
  SWARM_LIVE_OPS: 'tick_ops',
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