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
} from '../src/lib/procurement/pipeline';
import { main as daemonMain, snap as daemonSnap } from './daemon-tick-hands-free-v3.5.1';

const r2 = (n: any) => Math.round(Number(n || 0) * 100) / 100;
const $ = (n: any) => '$' + r2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function neonPing(tries = 8): Promise<boolean> {
  for (let i = 1; i <= tries; i++) {
    try {
      await (prisma.$queryRawUnsafe as any)`SELECT 1 AS ping_ok LIMIT 1`.catch(() => ({}));
      const r = await db.ownerAccount.count({ take: 1 });
      console.log(`  [ping ${i}] OK count=${r}`);
      return true;
    } catch (e: any) {
      const waitMs = i <= 3 ? 10000 : 15000;
      console.log(`  [ping ${i}] FAIL ${e?.code ?? '?'} ${(e?.message ?? '').slice(0, 100)} — sleep ${waitMs / 1000}s`);
      await new Promise((r) => setTimeout(r, waitMs));
      try { await db.$disconnect(); } catch (_) { }
      try { await prisma.$disconnect(); } catch (_) { }
    }
  }
  return false;
}

async function seedOneOwnerPO() {
  // create owner-funded PO for preset salary owner (RIB182) - small amount within budget
  const owners = await db.ownerAccount.findMany({ select: { id: true, label: true, accountNumberLast: true, currency: true, totalReceived: true, heldBalance: true, spendableBalance: true } });
  const salaryOwner = owners.find((o) => o.accountNumberLast === '182') ?? owners[0];
  if (!salaryOwner) return { ok: false, reason: 'no owners', po: null, itemId: null };
  const preset = await loadPresetOwnerIds();
  if (!preset.has(salaryOwner.id)) return { ok: false, reason: 'salary not in preset', po: null, itemId: null };

  const poAmount = 18.75; // small salary-bucket owner expenditure
  if (salaryOwner.heldBalance < poAmount + 0.02) {
    return { ok: false, reason: `heldBalance $${salaryOwner.heldBalance} < PO $${poAmount}`, po: null, itemId: null };
  }

  // create PO with supplier name matching label (fuzzy owner-funded detection)
  const po = await db.purchaseOrder.create({
    data: {
      poNumber: `PO-AUTO-HANDSFREE-${String(Date.now()).slice(-8)}`,
      title: `Owner internal transfer salary bucket advance v3.5.2`,
      supplierName: `${salaryOwner.label ?? 'Owner Salary RIB182'} — Owner Internal Transfer`,
      totalAmount: poAmount,
      currency: 'USD',
      status: 'pending',
      notes: `Owner hands-free auto-seed PO v3.5.2. Owner-funded scope: destination preset salary RIB182. ${poAmount} USD internal book advance.`,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  const item = await db.procurementItem.create({
    data: {
      purchaseOrder: { connect: { id: po.id } },
      name: `Owner internal transfer — salary bucket advance (${salaryOwner.label ?? 'RIB182'})`,
      reference: `PROC-AUTO-SALARY-${String(Date.now()).slice(-8)}`,
      category: 'owner_operations',
      recipientName: `${salaryOwner.label ?? 'Salary RIB182'} — Owner Account 182 — Attijariwafa Morocco`,
      recipientAddress: 'Rue Hassan II, Maarif, Casablanca, Morocco',
      deliveryCity: 'Casablanca',
      quantity: 1,
      expectedMinWeightKg: 0.01,
      unitPriceEst: poAmount,
      totalEst: poAmount,
      currency: 'USD',
      status: 'pending',
      supplierName: `${salaryOwner.label ?? 'Owner Salary RIB182'} — Owner Internal`,
      notes: `Owner hands-free auto-seed PO v3.5.2 owner-funded scope ${poAmount} USD salary bucket`,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  return { ok: true, po, itemId: item.id, ownerId: salaryOwner.id, amount: poAmount };
}

async function payoutBatch6Owners(amountUsd = 12.0) {
  // 6 payouts to the preset owners
  const buckets: BucketCode[] = ['salary_bucket', 'debt_repayment', 'sovereign_reserves', 'runtime_operations', 'runtime_operations', 'debt_repayment'];
  const currencies = ['MAD', 'MAD', 'USD', 'USD', 'EUR', 'USD'];
  const presetIds = Array.from(await loadPresetOwnerIds());
  const reqs: ReleaseRequest[] = [];
  for (let i = 0; i < presetIds.length && i < buckets.length; i++) {
    const ownerId = presetIds[i];
    const amount = i === 0 || i === 1 ? amountUsd * 10 : amountUsd; // MAD small USD equiv 120 MAD = ~12 USD
    reqs.push({
      ownerAccountId: ownerId,
      amount: r2(amount),
      currency: currencies[i],
      bucketCode: buckets[i],
      reference: `auto-v352-owner-${i + 1}-${Date.now()}`,
    });
  }
  console.log(`  payoutBatch6Owners: ${reqs.length} requests → first owner=${reqs[0]?.ownerAccountId?.slice(0, 12)}`);
  return await autoReleaseBatch(reqs);
}

async function main() {
  console.log('\n========== v3.5.2 OWNER HANDS-FREE AUTO-RUN SUITE ==========');
  console.log(`  policy env OWNER_HANDS_FREE_POLICY=${process.env.OWNER_HANDS_FREE_POLICY}  UNLOCK.len=${(process.env.OWNER_EXEC_UNLOCK ?? '').length}  DAEMON_TICK=${process.env.DAEMON_HANDS_FREE_TICK}`);
  console.log(`  policyActive()=  ${handsFreePolicyActive()}`);

  const STAGES: { name: string; ok: boolean; detail?: any; err?: string }[] = [];

  // S0: neon ping
  console.log('\n--- S0 Neon ping ---');
  const pingOk = await neonPing(6);
  STAGES.push({ name: 'S0_neon_ping', ok: pingOk, detail: { pingOk } });
  if (!pingOk) { console.error('FATAL: Neon still unreachable after 6 pings'); await db.$disconnect().catch(() => { }); return 2; }

  // S1: baseline snap
  console.log('\n--- S1 Baseline snap ---');
  const snap1 = await daemonSnap();
  console.log(`  PRE totalSent=${$(snap1.totalSent)}  completed=${snap1.completed}  needsManual=${snap1.needsManual}  held=${$(snap1.heldBalance)}  spendable=${$(snap1.spendableBalance)}`);

  // S2: daemon tick 1 (processNeedsManualBacklog + owner POs + reconciliation)
  console.log('\n--- S2 Daemon tick #1 ---');
  const t1code = await daemonMain();
  STAGES.push({ name: 'S2_daemon_tick_1', ok: t1code === 0 || t1code === 3, detail: { exitCode: t1code } });
  const snap2 = await daemonSnap();
  const delta1 = r2(snap2.totalSent - snap1.totalSent);
  console.log(`  POST-t1 totalSent=${$(snap2.totalSent)}  Δ=${$(delta1)}  completed=${snap2.completed}  needsManual=${snap2.needsManual}`);

  // S3: payout batch 6 owners (auto-approve + release)
  console.log('\n--- S3 Payout batch → 6 preset owners (auto-approve + release path) ---');
  const batch = await payoutBatch6Owners(12.0);
  STAGES.push({ name: 'S3_payout_batch_6owners', ok: batch.results.every((r: any) => r.ok || r.idempotentReplay), detail: { summary: batch.summary, n: batch.results.length } });
  console.log(`  batch summary ok=${batch.summary.ok}  idem=${batch.summary.idem}  fail=${batch.summary.fail}`);
  const snap3 = await daemonSnap();
  const delta2 = r2(snap3.totalSent - snap2.totalSent);
  console.log(`  POST-batch totalSent=${$(snap3.totalSent)}  Δ=${$(delta2)}  completed=${snap3.completed}`);

  // S4: seed owner PO + autoOwnerAdvanceToSettled
  console.log('\n--- S4 Seed + auto-settle owner-funded PO ---');
  let poAdvance: any = null;
  try {
    const seed = await seedOneOwnerPO();
    console.log(`  seed=${seed.ok}  reason=${seed.reason ?? 'ok'}  itemId=${seed.itemId?.slice(0, 12)}`);
    if (seed.ok && seed.itemId) {
      poAdvance = await autoOwnerAdvanceToSettled(seed.itemId, { ownerScopeForce: true });
      STAGES.push({ name: 'S4_auto_settle_PO', ok: poAdvance?.advanced?.length > 0 || poAdvance?.finalStatus === 'settled' || poAdvance?.skippedReason?.startsWith('hands-free') === false, detail: { finalStatus: poAdvance?.finalStatus, advancedN: (poAdvance?.advanced || []).length, skipped: poAdvance?.skippedReason, err: poAdvance?.error } });
      console.log(`  autoAdvance final=${poAdvance?.finalStatus}  advanced=[${(poAdvance?.advancedStatuses || []).join(',')}]  skipped=${poAdvance?.skippedReason ?? '—'}  err=${poAdvance?.error ?? '—'}`);
    } else {
      STAGES.push({ name: 'S4_auto_settle_PO', ok: false, detail: { skipped: true, reason: seed.reason } });
    }
  } catch (e: any) {
    STAGES.push({ name: 'S4_auto_settle_PO', ok: false, err: String(e?.message ?? e).slice(0, 240) });
    console.log(`  EXC ${String(e?.message ?? e).slice(0, 240)}`);
  }
  const snap4 = await daemonSnap();
  const delta3 = r2(snap4.totalSent - snap3.totalSent);
  console.log(`  POST-PO totalSent=${$(snap4.totalSent)}  Δ=${$(delta3)}  completed=${snap4.completed}`);

  // S5: daemon tick 2 IDEMPOTENCY check
  console.log('\n--- S5 Daemon tick #2 IDEMPOTENCY (expect ΔtotalSent < $0.02) ---');
  const t2code = await daemonMain();
  STAGES.push({ name: 'S5_daemon_tick_2_idempotency', ok: t2code === 0 || t2code === 3, detail: { exitCode: t2code } });
  const snap5 = await daemonSnap();
  const deltaIdem = r2(snap5.totalSent - snap4.totalSent);
  const idemPass = Math.abs(deltaIdem) < 0.02;
  STAGES.push({ name: 'S5_idempotency_delta_check', ok: idemPass, detail: { deltaTotalSent: deltaIdem, threshold: 0.02 } });
  console.log(`  POST-t2 totalSent=${$(snap5.totalSent)}  Δidempotency=${$(deltaIdem)}  ${idemPass ? 'PASS ✅' : 'FAIL ❌'}  completed=${snap5.completed}  needsManual=${snap5.needsManual}`);

  // S6: Overall totals
  const totalDelta = r2(snap5.totalSent - snap1.totalSent);
  console.log('\n====================================');
  console.log(`  OVERALL ΔtotalSent PRE→POST = ${$(totalDelta)}`);
  console.log(`  PRE  totalSent=${$(snap1.totalSent)}  completed=${snap1.completed}  needsManual=${snap1.needsManual}`);
  console.log(`  POST totalSent=${$(snap5.totalSent)}  completed=${snap5.completed}  needsManual=${snap5.needsManual}`);
  console.log('\n  Stage summary:');
  for (const s of STAGES) {
    const mark = s.ok ? '✅' : '❌';
    const extra = s.err ? ` ERR=${s.err.slice(0, 80)}` : '';
    console.log(`    ${mark} ${s.name.padEnd(38)} ${JSON.stringify(s.detail ?? {}).slice(0, 160)}${extra}`);
  }
  const passCount = STAGES.filter((s) => s.ok).length;
  console.log(`\n  ${passCount}/${STAGES.length} stages passed.`);

  // write artifact to gitignored data/out
  try {
    const fs = await import('node:fs');
    const dir = 'data/out';
    fs.mkdirSync(dir, { recursive: true });
    const path = `${dir}/auto-run-v352-suite-report.ndjson`;
    fs.appendFileSync(path, JSON.stringify({
      startedAt: new Date().toISOString(),
      policyActive: handsFreePolicyActive(),
      snapPre: snap1, snapPost: snap5, totalDelta, stages: STAGES,
      payoutBatchSummary: STAGES.find((s) => s.name === 'S3_payout_batch_6owners')?.detail,
      idempotency: { delta: deltaIdem, pass: idemPass, threshold: 0.02 },
    }) + '\n');
    console.log(`\n  report written → ${path}`);
  } catch (_) { }

  await db.$disconnect().catch(() => { });
  await prisma.$disconnect().catch(() => { });

  const exit = passCount === STAGES.length ? 0 : 4;
  console.log(`\n  suite exit=${exit}`);
  return exit;
}

if (typeof require !== 'undefined' ? require.main === module : import.meta.url?.endsWith(process.argv[1]?.replace(/\\/g, '/'))) {
  main().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(98); });
}

export { main, neonPing, payoutBatch6Owners, seedOneOwnerPO };
