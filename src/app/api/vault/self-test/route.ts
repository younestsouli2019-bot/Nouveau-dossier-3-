// POST/GET /api/vault/self-test
// Runs the auto-vault connector self-test across all 11 provider rails.
// Never moves funds; reports only credential-presence + real reachability.
//
//   GET /api/vault/self-test?provider=paypal   → single connector
//   GET /api/vault/self-test                    → all connectors
//   POST /api/vault/self-test { provider? }     → all (or one)
//

import { NextRequest, NextResponse } from 'next/server';
import { runSelfTest } from '@/lib/vault/connector-self-test';
import { VAULT_CONNECTORS } from '@/lib/vault/connector-self-test';

export async function GET(req: NextRequest) {
  const provider = req.nextUrl.searchParams.get('provider') || undefined;
  return handle(provider);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    return handle(body?.provider);
  } catch {
    return handle(undefined);
  }
}

async function handle(provider?: string) {
  const knownIds = VAULT_CONNECTORS.map((c) => c.id);
  if (provider && !knownIds.includes(provider)) {
    return NextResponse.json(
      { success: false, error: `Unknown connector id: ${provider}`, knownConnectors: knownIds },
      { status: 400 },
    );
  }

  try {
    const results = await runSelfTest(provider);
    const allConfigured = results.every((r) => r.configured);
    const allHealthy = results.every((r) => r.status === 'ok' || r.status === 'not_configured');

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      provider: provider || 'all',
      connectorCount: results.length,
      allConfigured,
      allHealthy,
      connectors: results,
    });
  } catch (error) {
    console.error('[vault/self-test] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Self-test failed to run' },
      { status: 500 },
    );
  }
}
