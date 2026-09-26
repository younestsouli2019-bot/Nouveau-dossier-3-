import 'dotenv/config';
import { prisma, db } from '../src/lib/db';
import {
  handsFreePolicyActive,
  loadPresetOwnerIds,
  isHandsFreeOwner,
  buildAutoRef,
  validateAutoRef,
  AUTO_RECEIPT_SIGNER,
} from '../src/lib/treasury/hands-free-policy';
import {
  autoReleaseOwnerFunds,
  autoReleaseBatch,
  ReleaseRequest,
  getOwnerAccountForBucket,
  BucketCode,
} from '../src/lib/treasury/release-engine';
import {
  autoOwnerAdvanceToSettled,
  AutoOwnerAdvanceResult,
} from '../src/lib/procurement/pipeline';
import { runBankReconciliation } from '../src/lib/bank-reconciliation';

const r2 = (n: any) => Math.round(Number(n || 0) * 100) / 100;
const pad = (s: any, n: number) => (String(s ?? '').length > n ? String(s ?? '').slice(0, n - 1) + '…' : String(s ?? '').padEnd(n));

interface TickReport {
  startedAt: string;
  finishedAt?: string;
  policyActive: boolean;
  policyReason?: string;
  presetOwnerCount: number;
  snapshotPre?: {
    totalSent: number;
    completed: number;
    needsManual: number;
    processing: number;
    heldBalance: number;
    spendableBalance: number;
  };
  snapshotPost?: typeof snapshotPostDefault;
  releasePhase?: {
    backlogNeedsManualProcessed: number;
    backlogCompleted: number;
    backlogFailures: number;
    autoBatchSummary?: { ok: number; idem: number; fail: number };
  };
  procurementPhase?: {
    ownerFundedEligible: number;
    settled: number;
    skipped: number;
    errors: number;
  };
  reconciliationPhase?: {
    matched: number;
    humanSignoffCount: number;
    autoApprovedCount: number;
    note?: string;
  };
  errors: string[];
}

const snapshotPostDefault = { totalSent: 0, completed: 0, needsManual: 0, processing: 0, heldBalance: 0, spendableBalance: 0, deltaTotalSent: 0 };

async function snap(): Promise<typeof snapshotPostDefault> {
  try {
    const byStatus: any[] = await (prisma.$queryRawUnsafe as any)(
      `SELECT status, COUNT(*)::int AS n FROM "OwnerSettlement" WHERE status IN ('completed','needs_manual_proof','processing') GROUP BY status;`
    ) as any[];
    const s = Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)]));
    const sums: any[] = await (prisma.$queryRawUnsafe as any)(
      `SELECT COALESCE(SUM("totalSent"::float),0)::float AS ts, COALESCE(SUM("heldBalance"::float),0)::float AS held, COALESCE(SUM("spendableBalance"::float),0)::float AS spend FROM "OwnerAccount";`
    ) as any[];
    return {
      completed: s.completed ?? 0,
      needsManual: s.needs_manual_proof ?? 0,
      processing: s.processing ?? 0,
      totalSent: r2(sums[0]?.ts ?? 0),
      heldBalance: r2(sums[0]?.held ?? 0),
      spendableBalance: r2(sums[0]?.spend ?? 0),
      deltaTotalSent: 0,
    };
  } catch (e: any) {
    console.error('[daemon-tick] snapshot query failed:', e?.message ?? String(e));
    return { ...snapshotPostDefault };
  }
}

async function processNeedsManualBacklog(): Promise<{ processed: number; completed: number; failures: number; summary?: { ok: number; idem: number; fail: number } }> {
  try {
    const preset = await loadPresetOwnerIds();
    if (preset.size === 0) return { processed: 0, completed: 0, failures: 0 };
    const rows = await prisma.ownerSettlement.findMany({
      where: {
        status: { in: ['needs_manual_proof', 'processing', 'pending'] },
        ownerAccountId: { in: Array.from(preset) },
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    if (rows.length === 0) return { processed: 0, completed: 0, failures: 0 };
    const reqs: ReleaseRequest[] = [];
    for (const r of rows) {
      const md = (() => { try { return JSON.parse(r.metadata || '{}'); } catch { return {}; } })();
      const bucket: BucketCode | undefined = md?.bucketCode
        ? /^(sovereign_reserves|runtime_operations|salary_bucket|debt_repayment|procurement_buffer)$/.test(md.bucketCode)
          ? md.bucketCode as BucketCode
          : undefined
        : undefined;
      reqs.push({
        ownerAccountId: r.ownerAccountId,
        amount: r2(r.amount),
        currency: (r.currency || 'USD').toUpperCase(),
        bucketCode: bucket,
        reference: r.referenceId || r.externalRef || undefined,
      });
    }
    const result = await autoReleaseBatch(reqs);
    return {
      processed: rows.length,
      completed: result.summary.ok + result.summary.idem,
      failures: result.summary.fail,
      summary: result.summary,
    };
  } catch (e: any) {
    return { processed: 0, completed: 0, failures: 1, summary: { ok: 0, idem: 0, fail: 1 } };
  }
}

async function processProcurement(): Promise<{ eligible: number; settled: number; skipped: number; errors: number; lastError?: string }> {
  let eligible = 0, settled = 0, skipped = 0, errors = 0;
  let lastError: string | undefined = undefined;
  try {
    const presetIds = await loadPresetOwnerIds();
    const presetOwners = await db.ownerAccount.findMany({
      where: { id: { in: Array.from(presetIds) } },
      select: { id: true, label: true, accountNumberLast: true, countryCode: true },
    });
    const presetLabels = presetOwners
      .map((o) => `${String(o.label ?? '')} ${String(o.accountNumberLast ?? '')}`.toLowerCase())
      .filter((s) => s.length > 4);
    const items = await db.procurementItem.findMany({
      where: { status: { notIn: ['settled', 'cancelled'] } },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    const eligibleItems = items.filter((it) => {
      if (!it.recipientName) return false;
      const n = it.recipientName.toLowerCase();
      if (presetLabels.some((l) => (n.length > 4 && l.includes(n.slice(0, 4))) || (l.length > 4 && n.includes(l.slice(0, 4))))) return true;
      if (n.includes('owner') && n.includes('hands') && n.includes('free')) return true;
      return false;
    });
    eligible = eligibleItems.length;
    for (const it of eligibleItems) {
      try {
        const res: AutoOwnerAdvanceResult = await autoOwnerAdvanceToSettled(it.id, { ownerScopeForce: true });
        if (res.finalStatus === 'settled') settled++;
        else if (res.scope === 'not-owner-funded' || res.scope === 'hands-free-inactive') skipped++;
        else if (res.error) { errors++; lastError = res.error; }
        else skipped++;
      } catch (e: any) { errors++; lastError = e?.message ?? String(e); }
    }
  } catch (e: any) { lastError = e?.message ?? String(e); errors++; }
  return { eligible, settled, skipped, errors, lastError };
}

async function tryReconciliation(): Promise<{ matched: number; humanSignoffCount: number; note?: string }> {
  try {
    const sampleCamt = `<?xml version="1.0" encoding="UTF-8"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"></Document>`;
    const empty = await runBankReconciliation(sampleCamt);
    return {
      matched: empty.matched,
      humanSignoffCount: empty.humanSignoffRequired.length,
      note: `ran Camt.053 engine (XML empty doc): unmatched settlements=${empty.unmatchedInternal} bank entries=${empty.totalBankEntries} duplicates blocked=${empty.duplicatesBlocked}`,
    };
  } catch (e: any) {
    return { matched: 0, humanSignoffCount: 0, note: `reconciliation skipped/errored: ${String(e?.message ?? e)}` };
  }
}

async function main(): Promise<number> {
  const report: TickReport = {
    startedAt: new Date().toISOString(),
    policyActive: false,
    presetOwnerCount: 0,
    errors: [],
  };
  console.log('\n================ daemon-tick-hands-free v3.5.1 (Owner Hands-Free Policy) ================\n');
  try {
    const pol = handsFreePolicyActive();
    report.policyActive = pol;
    const preset = await loadPresetOwnerIds();
    report.presetOwnerCount = preset.size;
    if (!pol) {
      report.policyReason = 'OWNER_HANDS_FREE_POLICY != true or OWNER_EXEC_UNLOCK length < 16. Exiting without mutations (fail-closed).';
      console.log(`  Policy INACTIVE — ${report.policyReason}`);
      console.log(`  Preset owners loaded: ${preset.size}`);
      console.log('  STATUS: OK (no mutations). exit=0');
      report.finishedAt = new Date().toISOString();
      return 0;
    }
    console.log(`  Policy ACTIVE  — OWNER_HANDS_FREE_POLICY=true + OWNER_EXEC_UNLOCK≥16. Preset owners: ${preset.size}.`);
    report.snapshotPre = await snap();
    console.log(`  [SNAP PRE] totalSent=$${report.snapshotPre.totalSent.toFixed(2)}  completed=${report.snapshotPre.completed}  needsManual=${report.snapshotPre.needsManual}  processing=${report.snapshotPre.processing}  held=$${report.snapshotPre.heldBalance.toFixed(2)}  spendable=$${report.snapshotPre.spendableBalance.toFixed(2)}`);

    console.log('\n--- PHASE 1/3: Owner preset backlog auto release (needsManual/processing) ---');
    const r1 = await processNeedsManualBacklog();
    report.releasePhase = {
      backlogNeedsManualProcessed: r1.processed,
      backlogCompleted: r1.completed,
      backlogFailures: r1.failures,
      autoBatchSummary: r1.summary,
    };
    console.log(`  backlog rows attempted: ${report.releasePhase.backlogNeedsManualProcessed}  completed=${report.releasePhase.backlogCompleted}  failures=${report.releasePhase.backlogFailures}`);
    if (report.releasePhase.autoBatchSummary) {
      const s = report.releasePhase.autoBatchSummary;
      console.log(`  summary: ok=${s.ok}  idempotent=${s.idem}  fail=${s.fail}`);
    }

    console.log('\n--- PHASE 2/3: Procurement owner-funded → settled ---');
    const p2 = await processProcurement();
    report.procurementPhase = {
      ownerFundedEligible: p2.eligible,
      settled: p2.settled,
      skipped: p2.skipped,
      errors: p2.errors,
    };
    console.log(`  eligible=${report.procurementPhase.ownerFundedEligible}  settled=${report.procurementPhase.settled}  skipped=${report.procurementPhase.skipped}  errors=${report.procurementPhase.errors}`);

    console.log('\n--- PHASE 3/3: Bank reconciliation (empty XML, engine sanity) ---');
    const r3 = await tryReconciliation();
    report.reconciliationPhase = {
      matched: r3.matched,
      humanSignoffCount: r3.humanSignoffCount,
      autoApprovedCount: 0,
      note: r3.note,
    };
    console.log(`  matched=${report.reconciliationPhase.matched}  humanSignoffRequired=${report.reconciliationPhase.humanSignoffCount}  autoApproved=${report.reconciliationPhase.autoApprovedCount}  note=${report.reconciliationPhase.note ?? ''}`);

    report.snapshotPost = await snap();
    report.snapshotPost.deltaTotalSent = r2(report.snapshotPost.totalSent - (report.snapshotPre?.totalSent ?? 0));
    console.log(`\n  [SNAP POST] totalSent=$${report.snapshotPost.totalSent.toFixed(2)}  Δ=$${report.snapshotPost.deltaTotalSent.toFixed(2)}  completed=${report.snapshotPost.completed}  needsManual=${report.snapshotPost.needsManual}  processing=${report.snapshotPost.processing}`);

    if (Math.abs(report.snapshotPost.deltaTotalSent) > 50000) {
      report.errors.push(`SUSPICIOUS ΔtotalSent=$${report.snapshotPost.deltaTotalSent.toFixed(2)} > $50k sanity cap — review run`);
      console.error(`  ❌ ${report.errors[report.errors.length - 1]}`);
    }
    report.finishedAt = new Date().toISOString();
    const exitCode = report.errors.length > 0 ? 3 : 0;
    console.log(`\n  FINISHED: exit=${exitCode}  duration=${((new Date(report.finishedAt).getTime() - new Date(report.startedAt).getTime()) / 1000).toFixed(1)}s`);
    return exitCode;
  } catch (e: any) {
    const err = e?.message ?? String(e);
    report.errors.push(`top-level error: ${err}`);
    console.error(`  FATAL daemon-tick error: ${err}`);
    report.finishedAt = new Date().toISOString();
    return 99;
  } finally {
    try {
      const fs = await import('node:fs');
      const dir = 'data/out';
      fs.mkdirSync(dir, { recursive: true });
      const path = `${dir}/daemon-tick-hands-free-v351.ndjson`;
      fs.appendFileSync(path, JSON.stringify(report) + '\n');
      console.log(`  report appended → ${path}`);
    } catch (_) {}
  }
}

if (typeof require !== 'undefined' ? require.main === module : import.meta.url?.endsWith(process.argv[1]?.replace(/\\/g, '/'))) {
  main().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(98); });
}

export { main, processNeedsManualBacklog, processProcurement, snap };
export type { TickReport };
