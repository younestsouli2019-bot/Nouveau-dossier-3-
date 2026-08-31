// GET /api/vault/connector/[id]
// Dedicated per-provider connector self-test endpoint.
// One dedicated endpoint per connector id (11 total): paypal, payoneer,
// banking_circle, attijariwafa, binance, bybit, bitget, wise, stripe, tron,
// googlepay. Never moves funds; reports credential-presence + real reachability.
//

import { NextRequest, NextResponse } from 'next/server';
import { runSelfTest, VAULT_CONNECTORS } from '@/lib/vault/connector-self-test';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const known = VAULT_CONNECTORS.find((c) => c.id === id);
  if (!known) {
    return NextResponse.json(
      {
        success: false,
        error: `Unknown connector id: ${id}`,
        knownConnectors: VAULT_CONNECTORS.map((c) => c.id),
      },
      { status: 404 },
    );
  }

  try {
    const [result] = await runSelfTest(id);
    return NextResponse.json({ success: true, connector: result });
  } catch (error) {
    console.error(`[vault/connector/${id}] Error:`, error);
    return NextResponse.json(
      { success: false, error: 'Connector self-test failed to run' },
      { status: 500 },
    );
  }
}
