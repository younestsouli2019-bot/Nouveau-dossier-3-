/**
 * payout-ops — MANUAL payout lifecycle CLI (settlement-gap P2, 2026-09-07).
 *
 * The single sanctioned way to drive a payout beyond RESERVED:
 *
 *   1. prepare   RESERVED -> VALIDATED -> READY   (owner approval REQUIRED)
 *   2. dispatch  READY -> SUBMITTING -> SUBMITTED  (fail-closed live gate)
 *   3. reconcile SUBMITTED/PROCESSING/UNKNOWN/COMPLETED -> RECONCILED
 *               (provider truth only; books the settlement ledger line)
 *   4. status    read-only counts (ids/amounts stay out of stdout)
 *
 * No daemon. No cron. No auto-approval. Every mutation names its actor and
 * lands as an immutable PayoutEvent. If DATABASE_URL is absent the tool
 * degrades to usage text without touching anything.
 *
 * Usage:
 *   npx tsx scripts/payout-ops.ts status
 *   npx tsx scripts/payout-ops.ts prepare   --id <payoutId> --by "<owner name>" --reason "<why>"
 *   npx tsx scripts/payout-ops.ts dispatch  --id <payoutId>
 *   npx tsx scripts/payout-ops.ts reconcile --id <payoutId>
 *   npx tsx scripts/payout-ops.ts reconcile --all
 */

import { preparePayout, dispatchPayout, type DispatchPrismaClient, type DispatchPayoutRow } from '../src/payout/dispatch';
import { advancePayoutReconciliation, reconcileAllPayouts, type ReconcileDeps } from '../src/payout/reconcile';

interface Args {
  command?: string;
  id?: string;
  by?: string;
  reason?: string;
  all?: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  const rest = [...argv];
  out.command = rest.shift();
  while (rest.length) {
    const a = rest.shift();
    if (a === '--id') out.id = rest.shift();
    else if (a === '--by') out.by = rest.shift();
    else if (a === '--reason') out.reason = rest.shift();
    else if (a === '--all') out.all = true;
  }
  return out;
}

function usage(): string {
  return __doc__.join('\n');
}
const __doc__ = [
  'usage: npx tsx scripts/payout-ops.ts <status|prepare|dispatch|reconcile> [flags]',
  '  status                              — counts by status (read-only)',
  '  prepare --id ID --by NAME --reason R — RESERVED -> READY (manual approval)',
  '  dispatch --id ID                    — READY -> SUBMITTED (fail-closed live gate)',
  '  reconcile --id ID | --all           — advance toward RECONCILED on provider truth',
];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.command || !['status', 'prepare', 'dispatch', 'reconcile'].includes(args.command)) {
    console.log(usage());
    process.exit(0);
  }
  if (!process.env.DATABASE_URL) {
    console.log('DATABASE_URL not set — nothing to operate on (graceful skip).');
    console.log(usage());
    process.exit(0);
  }

  const { PrismaClient } = (await import('@prisma/client')) as {
    PrismaClient: new () => DispatchPrismaClient & {
      revenueLedgerEntry: ReconcileDeps['ledger'];
      $connect(): Promise<void>;
      $disconnect(): Promise<void>;
    };
  };
  const prisma = new PrismaClient();
  await prisma.$connect();

  try {
    if (args.command === 'status') {
      const rows: DispatchPayoutRow[] = await prisma.payout.findMany({});
      const byStatus: Record<string, number> = {};
      for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      console.log('payouts by status:', JSON.stringify(byStatus));
      const flagged = rows.filter((r) => r.reconciliationStatus === 'RECONCILIATION_REQUIRED').length;
      console.log('reconciliation REQUIRED (UNKNOWN/unpollable):', flagged);
      process.exit(0);
    }

    if (args.command === 'prepare') {
      if (!args.id || !args.by) {
        console.log('prepare requires --id and --by (owner approval signature)');
        process.exit(1);
      }
      const res = await preparePayout(args.id, {
        approvedBy: args.by,
        approvalReason: args.reason || 'manual approval via payout-ops',
      }, { prisma });
      if (res.ok === true) {
        console.log(`OK: payout ${res.payoutId} is READY (v${res.version}) — dispatch when ready`);
      } else {
        console.log(`REFUSED: ${res.error}`);
        process.exit(1);
      }
      process.exit(0);
    }

    if (args.command === 'dispatch') {
      if (!args.id) {
        console.log('dispatch requires --id');
        process.exit(1);
      }
      const res = await dispatchPayout(args.id, { prisma });
      if (res.ok === true) {
        console.log(`OK: SUBMITTED via provider request ${res.providerRequestId} — reconcile to confirm`);
      } else {
        console.log(`${res.status ? `[${res.status}] ` : ''}REFUSED: ${res.error}`);
        process.exit(1);
      }
      process.exit(0);
    }

    if (args.command === 'reconcile') {
      if (args.all) {
        const summary = await reconcileAllPayouts({ prisma, ledger: prisma.revenueLedgerEntry });
        console.log(`reconcile sweep: checked ${summary.checked}, advanced ${summary.advanced}, flagged ${summary.flagged}, errors ${summary.errors}`);
        process.exit(0);
      }
      if (!args.id) {
        console.log('reconcile requires --id or --all');
        process.exit(1);
      }
      const res = await advancePayoutReconciliation(args.id, { prisma, ledger: prisma.revenueLedgerEntry });
      if (res.ok === true) {
        console.log(`OK: ${res.from} -> ${res.to} (${res.verdict})`);
      } else {
        console.log(`${res.flagged ? '[FLAGGED] ' : ''}${res.error}`);
        process.exit(res.flagged ? 2 : 1);
      }
      process.exit(0);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('payout-ops failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
