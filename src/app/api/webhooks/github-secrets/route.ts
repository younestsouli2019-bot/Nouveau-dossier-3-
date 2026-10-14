import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { prisma } from '@/lib/db';
import { sha256 } from '@/lib/strict-enforcement/crypto-utils';

import { activateKey } from '@/lib/connector-credentials';

/**
 * GitHub App / Dependabot Secrets sync webhook.
 *
 * 🚧 FAIL-CLOSED (P7):
 *   - GITHUB_WEBHOOK_SECRET DOIT être présent en variable d'env.
 *   - En cas d'absence: 401 immédiat sans aucun parsing ni audit (risque
 *     qu'un adversaire remplisse DB AuditLedger en masse de spam).
 *   - HMAC signature x-hub-signature-256 obligatoire, timingSafeEqual.
 */
const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;  // NOTA BENE: sans || ''

// Labels known connectors → mapping KEY_NAME → connector runtime id.
// Les valeurs ici sont des noms de connecteurs string (11 chars max). PAS des secrets.
// Les vraies valeurs secrets arrivent dans le body webhook (chiffré TLS).
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

function safeBufEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  try { return timingSafeEqual(a, b); } catch { return false; }
}

/**
 * FAIL-CLOSED verify:
 *   - Si secret absent → return false (NE PLUS return true).
 *   - Format signature obligatoire sha256=64hexa.
 *   - Compare timingSafeEqual sur buffers hex.
 */
function verifyHMAC(payload: string, signature: string): boolean {
  if (!WEBHOOK_SECRET) return false;                      // P7: FAIL-CLOSED
  if (!/^sha256=([0-9a-f]{64})$/i.test(signature)) return false;
  const expected = createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  const receivedBuf = Buffer.from(signature.slice('sha256='.length), 'hex');
  return safeBufEqual(expectedBuf, receivedBuf);
}

export async function POST(req: NextRequest) {
  // P7: GATE FAIL-CLOSED secret & HMAC avant tout parsing body.
  if (!WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: 'Webhook secret not configured — fail-closed 401 (GITHUB_WEBHOOK_SECRET env required)' },
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
  const source = req.headers.get('x-source') || 'unknown';

  // P7: !WEBHOOK_SECRET || !verify → rejet (fail-closed à cause de ||, pas &&)
  if (!verifyHMAC(rawBody, signature)) {
    try {
      await prisma.auditLedger.create({
        data: {
          entityType: 'secrets_sync',
          entityId: 'rejected',
          action: 'hmac_verification_failed',
          entryHash: await sha256(`github-secrets:rejected:${Date.now()}`),
          performedBy: source,
          discrepancyNote: 'HMAC signature mismatch OR secret not provided (P7 fail-closed gate)',
        },
      });
    } catch { /* ignore DB errors on rejet path; 401 reste retourné */ }
    return NextResponse.json({ error: 'Invalid HMAC signature' }, { status: 401 });
  }

  let payload: any = {};
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
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
        receivedKeys: received.map((k) => k.slice(0, 4) + '***'),
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
}

export async function GET() {
  return NextResponse.json({
    status: 'active',
    endpoint: 'github-secrets',
    verification: 'x-hub-signature-256 HMAC-SHA256 (fail-closed, GITHUB_WEBHOOK_SECRET env required)',
  });
}
