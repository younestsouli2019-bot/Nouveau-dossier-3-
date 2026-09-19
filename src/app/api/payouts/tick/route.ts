/**
 * Payout tick endpoint ΓÇö the hourly engine entry that drives payouts through
 * the state machine past RESERVED toward RECONCILED. Settlement-gap P0/P1.
 *
 * POST /api/payouts/tick
 *   Header: x-tick-secret: <PAYOUT_TICK_SECRET env>
 *
 * Fail-closed properties:
 *  - No secret configured => 503, the tick never runs open.
 *  - Live rails require SWARM_LIVE && PAYPAL_PPP2_APPROVED &&
 *    PAYPAL_PPP2_ENABLE_SEND && credentials. Anything missing => the provider
 *    runs dry-run (honest UNKNOWN, never fabricated evidence).
 *  - Bounded: at most PAYOUT_TICK_LIMIT payouts per call (default 50).
 */

import { db as prisma } from '@/lib/db';
import { createHash } from 'node:crypto';
import { createPrismaPayoutStore } from '../../../../payout/prisma-driver';
import { runPayoutTick, type PipelineConfig } from '../../../../payout/pipeline';
import {
  getProviderForDestination,
  type DestinationType,
  type PayoutProvider,
} from '../../../../payout/provider';
import { LivePayPalPayoutProvider } from '../../../../payout/adapters/paypal-live';


function envIsTrue(v: string | undefined): boolean {
  return v === 'true' || v === '1';
}

/**
 * Resolve a destination fingerprint to a raw PayPal email via the validated
 * OwnerAccount store. Raw destinations never leave this boundary.
 */
async function resolvePayPalDestination(fingerprint: string): Promise<string> {
  const accounts = await prisma.ownerAccount.findMany({
    where: { isActive: true, paypalEmail: { not: null } },
    select: { paypalEmail: true },
  });
  for (const a of accounts) {
    const email = a.paypalEmail;
    if (!email) continue;
    if (createHash('sha256').update(email.trim().toLowerCase()).digest('hex') === fingerprint) {
      return email;
    }
  }
  throw new Error(`no active owner account matches destination fingerprint ${fingerprint}`);
}

/**
 * Three INDEPENDENT live gates:
 *   - PayPal live: SWARM_LIVE + PPP2 approved + enabled + PayPal credentials (Payouts PPP2 program required)
 *   - Bank wire live: SWARM_LIVE + BANK_RAIL_API_KEY + BANK_RAIL_ACCOUNT_ID (Wise/SEPA/Bank Circle rails)
 *   - Crypto live : SWARM_LIVE + CRYPTO_SIGNING_POLICY + CRYPTO_HOT_WALLET_REF (hot-wallet signing policy)
 * Before this fix, all 3 were tied to PayPal PPP2 flags — making bank/crypto live impossible
 * until PayPal PPP2 was approved. The per-type split makes each rail standalone.
 */
function buildPayPalLiveConfig() {
  const live =
    envIsTrue(process.env.SWARM_LIVE) &&
    envIsTrue(process.env.PAYPAL_PPP2_APPROVED) &&
    envIsTrue(process.env.PAYPAL_PPP2_ENABLE_SEND) &&
    Boolean(process.env.PAYPAL_CLIENT_ID) &&
    Boolean(process.env.PAYPAL_CLIENT_SECRET);
  return {
    live,
    liveConfig: {
      PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID,
      PAYPAL_CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET,
      PAYPAL_PAYOUTS_API_BASE: process.env.PAYPAL_PAYOUTS_API_BASE ?? 'https://api-m.paypal.com',
    },
  };
}

function buildBankLiveConfig() {
  const live =
    envIsTrue(process.env.SWARM_LIVE) &&
    Boolean(process.env.BANK_RAIL_API_KEY) &&
    Boolean(process.env.BANK_RAIL_ACCOUNT_ID);
  return {
    live,
    liveConfig: {
      BANK_RAIL_API_KEY: process.env.BANK_RAIL_API_KEY,
      BANK_RAIL_ACCOUNT_ID: process.env.BANK_RAIL_ACCOUNT_ID,
    },
  };
}

function buildCryptoLiveConfig() {
  const live =
    envIsTrue(process.env.SWARM_LIVE) &&
    Boolean(process.env.CRYPTO_SIGNING_POLICY) &&
    Boolean(process.env.CRYPTO_HOT_WALLET_REF);
  return {
    live,
    liveConfig: {
      CRYPTO_SIGNING_POLICY: process.env.CRYPTO_SIGNING_POLICY,
      CRYPTO_HOT_WALLET_REF: process.env.CRYPTO_HOT_WALLET_REF,
    },
  };
}

function buildProviders(): PipelineConfig['providers'] {
  const paypalCfg = buildPayPalLiveConfig();
  const bankCfg = buildBankLiveConfig();
  const cryptoCfg = buildCryptoLiveConfig();
  const apiBase = paypalCfg.liveConfig.PAYPAL_PAYOUTS_API_BASE!;
  const livePayPal = paypalCfg.live
    ? new LivePayPalPayoutProvider({ live: paypalCfg.live, liveConfig: paypalCfg.liveConfig }, {
        apiBase,
        clientId: process.env.PAYPAL_CLIENT_ID!,
        clientSecret: process.env.PAYPAL_CLIENT_SECRET!,
        resolveDestination: resolvePayPalDestination,
      })
    : null;

  return (destinationType: DestinationType): PayoutProvider | null => {
    switch (destinationType) {
      case 'paypal':
        return livePayPal ?? getProviderForDestination('paypal', paypalCfg);
      case 'bank':
        return getProviderForDestination('bank', bankCfg);
      case 'crypto':
        return getProviderForDestination('crypto', cryptoCfg);
      default:
        return null;
    }
  };
}

export async function POST(req: Request) {
  const secret = process.env.PAYOUT_TICK_SECRET;
  if (!secret) {
    return Response.json(
      { ok: false, error: 'PAYOUT_TICK_SECRET not configured ΓÇö tick is fail-closed' },
      { status: 503 }
    );
  }
  if (req.headers.get('x-tick-secret') !== secret) {
    return Response.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  const limit = Number(process.env.PAYOUT_TICK_LIMIT ?? 50);
  const store = createPrismaPayoutStore(prisma);
  const providers = buildProviders();

  try {
    const report = await runPayoutTick(store, { providers }, Number.isFinite(limit) ? limit : 50);
    return Response.json({ ok: true, ...report });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function GET() {
  return Response.json({ ok: false, error: 'POST only' }, { status: 405 });
}
