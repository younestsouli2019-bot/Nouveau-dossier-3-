import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { getAllOwnerWallets, getConfiguredWallets } from '@/lib/owner-config';

// ─── OWNER WALLET ADDRESSES ──────────────────────────────────────────────────

const OWNER_WALLETS = getAllOwnerWallets();

// ─── USD CONVERSION RATES ────────────────────────────────────────────────────

const USD_RATES: Record<string, number> = {
  ETH: 3500,
  WBTC: 65000,
  USDC: 1,
};

function toUsd(token: string, amount: number): number {
  return (USD_RATES[token] || 0) * amount;
}

// ─── OWNER WALLET VERIFICATION GUARD ────────────────────────────────────────
//
// Owner wallets are pre-configured from day 1. Any settlement record where
// the recipient does NOT match the owner wallet for that network is flagged
// as an anomaly that requires investigation.
// ─────────────────────────────────────────────────────────────────────────────

function verifyOwnerRouting(settlement: { network: string; recipientAddress: string | null }): {
  isOwner: boolean;
  ownerWallet: string | undefined;
  anomaly: boolean;
  anomalyReason?: string;
} {
  const ownerWallet = OWNER_WALLETS[settlement.network];
  if (!settlement.recipientAddress || !ownerWallet) {
    return { isOwner: false, ownerWallet, anomaly: true, anomalyReason: 'Missing recipient or owner wallet config' };
  }
  const recipient = settlement.recipientAddress.toLowerCase();
  const owner = ownerWallet.toLowerCase();
  const isOwner = recipient === owner;
  return {
    isOwner,
    ownerWallet,
    anomaly: !isOwner,
    anomalyReason: !isOwner ? `Recipient ${recipient.slice(0, 10)}... does not match owner wallet for ${settlement.network}` : undefined,
  };
}

// ─── GET HANDLER ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const network = searchParams.get('network');
  const status = searchParams.get('status');
  const token = searchParams.get('token');

  const where: Record<string, unknown> = {};
  if (network) where.network = network;
  if (status) where.status = status;
  if (token) where.token = token;

  const settlements = await db.cryptoSettlement.findMany({
    where: Object.keys(where).length > 0 ? where : undefined,
    orderBy: { txTime: 'desc' },
  });

  // Verify owner routing for each settlement and flag anomalies
  const verifiedSettlements = settlements.map(s => {
    const verification = verifyOwnerRouting(s);
    return {
      ...s,
      _verification: verification,
    };
  });

  // Per-network breakdown
  const networkNames = ['arbitrum', 'optimism', 'base', 'polygon_zkevm', 'linea', 'scroll'] as const;
  const networkBreakdown: Record<string, {
    total: number; ownerRouted: number; anomalies: number;
    confirmed: number; pending: number; failed: number;
    totalUsd: number; ownerUsd: number
  }> = {};

  for (const n of networkNames) {
    const ns = verifiedSettlements.filter(s => s.network === n);
    networkBreakdown[n] = {
      total: ns.length,
      ownerRouted: ns.filter(s => s._verification.isOwner).length,
      anomalies: ns.filter(s => s._verification.anomaly).length,
      confirmed: ns.filter(s => s.status === 'confirmed').length,
      pending: ns.filter(s => s.status === 'pending').length,
      failed: ns.filter(s => s.status === 'failed').length,
      totalUsd: ns.reduce((sum, s) => sum + toUsd(s.token, s.amount), 0),
      ownerUsd: ns.filter(s => s._verification.isOwner).reduce((sum, s) => sum + toUsd(s.token, s.amount), 0),
    };
  }

  const anomalies = verifiedSettlements.filter(s => s._verification.anomaly);
  const confirmedAnomalies = anomalies.filter(s => s.status === 'confirmed');

  const summary = {
    total: settlements.length,
    ownerRouted: verifiedSettlements.filter(s => s._verification.isOwner).length,
    anomalies: anomalies.length,
    confirmedAnomalies: confirmedAnomalies.length,
    networksTotal: new Set(settlements.map(s => s.network)).size,
    networksWithAnomalies: new Set(anomalies.map(s => s.network)).size,
    totalUsd: settlements.reduce((sum, s) => sum + toUsd(s.token, s.amount), 0),
    ownerUsd: verifiedSettlements.filter(s => s._verification.isOwner).reduce((sum, s) => sum + toUsd(s.token, s.amount), 0),
    anomalyUsd: anomalies.reduce((sum, s) => sum + toUsd(s.token, s.amount), 0),
    networkBreakdown,
  };

  return NextResponse.json({
    settlements: verifiedSettlements,
    summary,
    ownerWallets: OWNER_WALLETS,
  });
}

// ─── POST HANDLER — Owner Wallet Verification for Ingestion ──────────────────
//
// This endpoint validates new crypto settlement records against owner wallets.
// Any record where the recipient doesn't match the owner wallet for that network
// is REJECTED with a clear error — preventing misplaced routing at the gate.
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, settlements } = body as {
      action?: string;
      settlements?: Array<{
        network: string;
        recipientAddress: string;
        txHash: string;
        type: string;
        token: string;
        amount: number;
        gasUsed?: number;
        status?: string;
      }>;
    };

    if (action === 'verify_batch') {
      // Verify a batch of new settlements against owner wallets
      if (!settlements || settlements.length === 0) {
        return NextResponse.json(
          { ok: false, message: 'No settlements provided for verification.' },
          { status: 400 },
        );
      }

      const results = settlements.map(s => {
        const verification = verifyOwnerRouting(s);
        return {
          txHash: s.txHash,
          network: s.network,
          recipientAddress: s.recipientAddress,
          ownerWallet: verification.ownerWallet || 'NOT CONFIGURED',
          isOwner: verification.isOwner,
          passed: !verification.anomaly,
          anomalyReason: verification.anomalyReason,
        };
      });

      const allPassed = results.every(r => r.passed);
      const failed = results.filter(r => !r.passed);

      return NextResponse.json({
        ok: allPassed,
        message: allPassed
          ? `All ${results.length} settlements pass owner wallet verification.`
          : `${failed.length}/${results.length} settlements FAILED owner wallet verification.`,
        total: results.length,
        passed: results.filter(r => r.passed).length,
        failed: failed.length,
        results,
      });
    }

    return NextResponse.json(
      { ok: false, message: `Unknown action: ${action}. Use 'verify_batch' to validate settlements against owner wallets.` },
      { status: 400 },
    );
  } catch (error) {
    console.error('[crypto-settlements] POST error:', error);
    return NextResponse.json(
      { ok: false, message: 'Internal server error' },
      { status: 500 },
    );
  }
}
