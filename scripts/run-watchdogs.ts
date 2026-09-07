/**
 * Settlement Watchdog Tick — P1 (2026-09-07).
 *
 * Runs the Treasury + Reconciliation watchdogs against REAL Prisma reads.
 * It DIAGNOSES ONLY: no state mutations, no money movement, no dispatch.
 *
 * Behavior:
 *  - No DATABASE_URL -> graceful skip (exit 0). The tick is a diagnosis,
 *    not an obligation to crash environments without a readable replica.
 *  - Detailed findings go to reports/watchdog/<ts>.json — which is
 *    GITIGNORED and never printed. Public CI logs on a public repo must
 *    carry counts only: no ids, no amounts, no destinations.
 *  - Findings are data: exit 0 when the watchdog found problems (that is
 *    the system working). Exit 1 only on infrastructure failure.
 *
 * Usage: npx tsx ./scripts/run-watchdogs.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { scanTreasury } from '../src/treasury/watchdog';
import { reconcilePayout, type ProviderRecord } from '../src/recon/watchdog';
import {
  createPrismaWatchdogSources,
  type WatchdogPrismaClient,
} from '../src/payout/prisma-sources';

const REPORT_DIR = 'reports/watchdog';
const OWNER_ACCOUNT_ID = process.env.WATCHDOG_OWNER_ACCOUNT_ID ?? 'OWNER_MAIN';
const CURRENCY = process.env.WATCHDOG_CURRENCY ?? 'USD';

function countByKind<T extends { kind: string }>(findings: readonly T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of findings) out[f.kind] = (out[f.kind] ?? 0) + 1;
  return out;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log('[watchdog-tick] skipped: no DATABASE_URL (read-only diagnosis needs a readable replica)');
    return;
  }

  // Dynamic import: keeps this script loadable in environments where the
  // Prisma client was never generated (unit-test sandboxes, CI without DB).
  const { PrismaClient } = (await import('@prisma/client')) as {
    PrismaClient: new () => WatchdogPrismaClient & {
      $disconnect(): Promise<void>;
      payoutEvent: { findMany(args?: Record<string, unknown>): Promise<Array<{ payoutId: string; evidence: unknown; actor: string }>> };
      $connect(): Promise<void>;
    };
  };
  const prisma = new (PrismaClient as never as new () => any)();

  try {
    await prisma.$connect();
    const sources = createPrismaWatchdogSources(prisma as WatchdogPrismaClient);

    // ── Treasury scan ──────────────────────────────────────────────────
    const treasuryFindings = await scanTreasury(sources, {
      ownerAccountId: OWNER_ACCOUNT_ID,
      currency: CURRENCY,
    });

    // ── Reconciliation scan ───────────────────────────────────────────
    // Internal records: payouts in flight. Provider records: whatever
    // evidence the durable PayoutEvent log captured from providers.
    // (Deep provider REST pulls are P2 — this tick reconciles what we
    // durably recorded, and names the gaps.)
    const inFlight = await sources.listUnreconciledPayouts();
    const providerEvents = await prisma.payoutEvent.findMany({
      where: { actor: 'provider' },
      select: { payoutId: true, evidence: true },
    });
    const providerRecords: ProviderRecord[] = [];
    for (const ev of providerEvents) {
      const e = (ev.evidence ?? {}) as Record<string, unknown>;
      if (typeof e.providerTransactionId === 'string' && typeof e.amount === 'number') {
        providerRecords.push({
          providerTransactionId: e.providerTransactionId,
          amount: e.amount,
          currency: typeof e.currency === 'string' ? e.currency : CURRENCY,
        });
      }
    }

    const reconFindings = inFlight.map((p) =>
      reconcilePayout(
        {
          payoutId: p.id,
          idempotencyKey: `payout:${p.id}`,
          amount: p.netAmount,
          currency: p.currency,
          providerTransactionId: p.providerTransactionId ?? undefined,
        },
        providerRecords.find(
          (r) => r.providerTransactionId === p.providerTransactionId
        ),
        providerRecords
      )
    );

    // ── Report: counts to stdout, details to gitignored file ────────────
    const treasuryCounts = countByKind(treasuryFindings);
    const reconCounts: Record<string, number> = {};
    for (const f of reconFindings) reconCounts[f.status] = (reconCounts[f.status] ?? 0) + 1;

    mkdirSync(REPORT_DIR, { recursive: true });
    const reportPath = `${REPORT_DIR}/tick-${Date.now()}.json`;
    writeFileSync(
      reportPath,
      JSON.stringify(
        {
          ranAt: new Date().toISOString(),
          mode: 'DIAGNOSE_ONLY',
          ownerAccountId: OWNER_ACCOUNT_ID,
          currency: CURRENCY,
          treasuryFindings,
          reconFindings,
        },
        null,
        2
      )
    );

    const totalFindings = treasuryFindings.length + reconFindings.length;
    console.log(`[watchdog-tick] treasury findings: ${treasuryFindings.length} ${JSON.stringify(treasuryCounts)}`);
    console.log(`[watchdog-tick] recon findings: ${reconFindings.length} ${JSON.stringify(reconCounts)}`);
    console.log(`[watchdog-tick] total findings: ${totalFindings} (details: ${reportPath}, gitignored — never committed, never printed)`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[watchdog-tick] infrastructure failure:', (err as Error).message);
  process.exit(1);
});
