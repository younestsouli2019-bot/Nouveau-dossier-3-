/**
 * payout-ops — payout lifecycle CLI over the SINGLE pipeline engine.
 * Owner hands-free payout policy (2026-09-07): no per-payout manual approval;
 * the event-driven state machine advances payouts through legal transitions
 * only, inside the fail-closed guardrails:
 *
 *   - SWARM_LIVE + per-rail gates (e.g. PayPal PPP2_APPROVED + PPP2_ENABLE_SEND
 *     + credentials) decide whether anything REAL can be sent. Missing =>
 *     LivePathUnavailableError => RETRYABLE_FAILURE (provably nothing sent).
 *   - Caps: max per-payout, rolling-24h settled per currency, daily failed-
 *     submit throttle. UNKNOWN NEVER re-submits (reconciliation/quarantine only).
 *
 * Commands:
 *   status            — counts by status (read-only)
 *   tick [--limit N]  — one bounded pipeline pass (same as POST /api/payouts/tick)
 *   advance --id ID   — advance ONE payout a single legal transition
 *
 * The hourly automation is the deployed tick endpoint (POST /api/payouts/tick,
 * x-tick-secret gated); this CLI is the manual ops window into the SAME engine.
 */

import { runPayoutTick, advancePayout, type PipelineConfig } from '../src/payout/pipeline';
import { createPrismaPayoutStore } from '../src/payout/prisma-driver';
import {
  getProviderForDestination,
  type DestinationType,
  type PayoutProvider,
} from '../src/payout/provider';
import { LivePayPalPayoutProvider } from '../src/payout/adapters/paypal-live';
import { createHash } from 'node:crypto';

interface Args {
  command?: string;
  id?: string;
  limit?: number;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  const rest = [...argv];
  out.command = rest.shift();
  while (rest.length) {
    const a = rest.shift();
    if (a === '--id') out.id = rest.shift();
    else if (a === '--limit') out.limit = Number(rest.shift());
  }
  return out;
}

const USAGE = [
  'usage: npx tsx scripts/payout-ops.ts <status|tick|advance> [flags]',
  '  status            — payout counts by status (read-only)',
  '  tick [--limit N]  — one bounded pipeline pass (bounded, fail-closed rails)',
  '  advance --id ID   — advance ONE payout a single legal transition',
];

function envIsTrue(v: string | undefined): boolean {
  return v === 'true' || v === '1';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.command || !['status', 'tick', 'advance'].includes(args.command)) {
    console.log(USAGE.join('\n'));
    process.exit(0);
  }
  await run(args);
}

async function run(args: Args) {
  if (!process.env.DATABASE_URL) {
    console.log('DATABASE_URL not set — nothing to operate on (graceful skip).');
    console.log(USAGE.join('\n'));
    process.exit(0);
  }

  const { PrismaClient } = (await import('@prisma/client')) as {
    PrismaClient: new () => any;
  };
  const prisma = new PrismaClient();
  await prisma.$connect();

  try {
    if (args.command === 'status') {
      const rows = await prisma.payout.findMany({});
      const byStatus: Record<string, number> = {};
      for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      console.log('payouts by status:', JSON.stringify(byStatus));
      const flagged = rows.filter((r: any) => r.reconciliationStatus === 'RECONCILIATION_REQUIRED').length;
      const evidence = rows.filter((r: any) => r.reconciliationStatus === 'EVIDENCE_PENDING').length;
      console.log('reconciliation REQUIRED:', flagged, '| EVIDENCE_PENDING:', evidence);
      process.exit(0);
    }

    const store = createPrismaPayoutStore(prisma);
    const providers = buildProviders(prisma);
    const config: PipelineConfig = { providers };

    if (args.command === 'tick') {
      const limit = Number.isFinite(args.limit) ? args.limit! : 50;
      const report = await runPayoutTick(store, config, limit);
      console.log('tick report:', JSON.stringify(report));
      process.exit(0);
    }

    // advance --id
    if (!args.id) {
      console.log('advance requires --id');
      process.exit(1);
    }
    const out = await advancePayout(store, config, args.id);
    console.log('advance outcome:', JSON.stringify(out));
    process.exit(0);
  } finally {
    await prisma.$disconnect();
  }
}

/** Same fail-closed provider wiring as the deployed tick endpoint. */
function buildProviders(prisma: any): PipelineConfig['providers'] {
  const live =
    envIsTrue(process.env.SWARM_LIVE) &&
    envIsTrue(process.env.PAYPAL_PPP2_APPROVED) &&
    envIsTrue(process.env.PAYPAL_PPP2_ENABLE_SEND) &&
    Boolean(process.env.PAYPAL_CLIENT_ID) &&
    Boolean(process.env.PAYPAL_CLIENT_SECRET);
  const config = {
    live,
    liveConfig: {
      PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID,
      PAYPAL_CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET,
      PAYPAL_PAYOUTS_API_BASE: process.env.PAYPAL_PAYOUTS_API_BASE ?? 'https://api-m.paypal.com',
      BANK_RAIL_API_KEY: process.env.BANK_RAIL_API_KEY,
      BANK_RAIL_ACCOUNT_ID: process.env.BANK_RAIL_ACCOUNT_ID,
    },
  };

  async function resolvePayPalDestination(fingerprint: string): Promise<string> {
    const accounts = await prisma.ownerAccount.findMany({
      where: { isActive: true, paypalEmail: { not: null } },
      select: { paypalEmail: true },
    });
    for (const a of accounts) {
      const email: string | null = a.paypalEmail;
      if (!email) continue;
      if (createHash('sha256').update(email.trim().toLowerCase()).digest('hex') === fingerprint) {
        return email;
      }
    }
    throw new Error(`no active owner account matches destination fingerprint ${fingerprint}`);
  }

  const livePayPal = live
    ? new LivePayPalPayoutProvider(config as never, {
        apiBase: config.liveConfig.PAYPAL_PAYOUTS_API_BASE as string,
        clientId: process.env.PAYPAL_CLIENT_ID as string,
        clientSecret: process.env.PAYPAL_CLIENT_SECRET as string,
        resolveDestination: resolvePayPalDestination,
      })
    : null;

  return (destinationType: DestinationType): PayoutProvider | null => {
    switch (destinationType) {
      case 'paypal':
        return livePayPal ?? getProviderForDestination('paypal', config as never);
      case 'bank':
        return getProviderForDestination('bank', config as never);
      case 'crypto':
        return getProviderForDestination('crypto', config as never);
      default:
        return null;
    }
  };
}

main().catch((err) => {
  console.error('payout-ops failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
