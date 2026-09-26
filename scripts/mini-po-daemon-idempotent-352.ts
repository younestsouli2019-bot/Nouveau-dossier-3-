import 'dotenv/config';
import { prisma, db } from '../src/lib/db';
import {
  handsFreePolicyActive,
  loadPresetOwnerIds,
  AUTO_RECEIPT_SIGNER,
} from '../src/lib/treasury/hands-free-policy';
import { autoOwnerAdvanceToSettled } from '../src/lib/procurement/pipeline';
import { main as daemonMain, snap as daemonSnap } from './daemon-tick-hands-free-v3.5.1';

const r2 = (n: any) => Math.round(Number(n || 0) * 100) / 100;
const $ = (n: any) => '$' + r2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function waitNeonPing(max = 4): Promise<boolean> {
  for (let i = 1; i <= max; i++) {
    try {
      const r = await db.ownerAccount.count({ take: 1 });
      console.log(`  ping ${i} OK count=${r}`);
      return true;
    } catch (e: any) {
      console.log(`  ping ${i} FAIL ${e?.code} — sleep 8s`);
      await new Promise((r) => setTimeout(r, 8000));
      try { await db.$disconnect(); } catch (_) { }
    }
  }
  return false;
}

async function seedOwnerPo(amount = 19.5): Promise<{ ok: boolean; itemId: string | null; poId: string | null; reason?: string }> {
  const owners = await db.ownerAccount.findMany({ select: { id: true, label: true, accountNumberLast: true, heldBalance: true } });
  const salary = owners.find((o) => o.accountNumberLast === '182') ?? owners[0];
  if (!salary) return { ok: false, itemId: null, poId: null, reason: 'no owners' };
  if ((salary.heldBalance ?? 0) < amount + 0.02) return { ok: false, itemId: null, poId: null, reason: `heldBalance insufficient ${salary.heldBalance}` };
  const po = await db.purchaseOrder.create({
    data: {
      poNumber: `PO-AUTO-HF-${String(Date.now()).slice(-8)}`,
      title: `Owner salary bucket advance v3.5.2 (${salary.label ?? 'RIB182'})`,
      supplierName: `${salary.label ?? 'Owner Salary Internal'} — Preset RIB182`,
      totalAmount: amount,
      currency: 'USD',
      status: 'pending',
      notes: `Owner hands-free v3.5.2 seed PO ${amount} USD preset salary RIB182. owner-funded scope via fuzzy supplierName/label match.`,
    },
  });
  const item = await db.procurementItem.create({
    data: {
      purchaseOrder: { connect: { id: po.id } },
      name: `Owner internal salary advance — ${salary.label ?? 'RIB182 Attijariwafa MA'}`,
      reference: `PROC-HF-SAL-${String(Date.now()).slice(-8)}`,
      category: 'owner_operations',
      recipientName: `${salary.label ?? 'Salary RIB182'} — Owner Account preset Attijariwafa Morocco`,
      recipientAddress: 'Maarif Casablanca Morocco',
      deliveryCity: 'Casablanca',
      quantity: 1,
      expectedMinWeightKg: 0.01,
      unitPriceEst: amount,
      totalEst: amount,
      currency: 'USD',
      status: 'pending',
      supplierName: `${salary.label ?? 'Owner Internal'} — preset RIB 594 182`,
      notes: `Owner-funded scope HANDS-FREE v3.5.2 seed PO ${amount} USD, owner accountNumberLast=182 (salary) bucket advance. Auto pipeline to settled via autoOwnerAdvanceToSettled ownerScopeForce=true. Confirmer=${AUTO_RECEIPT_SIGNER}`,
    },
  });
  return { ok: true, itemId: item.id, poId: po.id };
}

async function main() {
  console.log('\n==== v3.5.2 MINI: Seed PO settle + daemon triple idempotency ====');
  console.log(`  policyActive=${handsFreePolicyActive()}`);
  const ping = await waitNeonPing(4);
  if (!ping) { console.log('Neon still cold'); return 2; }
  const snapA = await daemonSnap();
  console.log(`\n  PRE(A): totalSent=${$(snapA.totalSent)} completed=${snapA.completed} needsManual=${snapA.needsManual} processing=${snapA.processing}`);

  // Step1: seed PO + auto settle
  console.log('\n--- STEP 1: seed + settle one owner-funded PO ---');
  let seed: any = null;
  let adv: any = null;
  try {
    seed = await seedOwnerPo(19.5);
    console.log(`  seed ok=${seed.ok} reason=${seed.reason ?? '—'} poId=${seed.poId?.slice(0, 12)} itemId=${seed.itemId?.slice(0, 12)}`);
    if (seed.ok) {
      adv = await autoOwnerAdvanceToSettled(seed.itemId, { ownerScopeForce: true });
      console.log(`  autoAdvance finalStatus=${adv?.finalStatus ?? '?'} advanced=[${(adv?.advancedStatuses ?? []).join(',')}] skippedReason=${adv?.skippedReason ?? '—'} err=${adv?.error ?? '—'}`);
    }
  } catch (e: any) { console.log(`  EXC ${(e?.message ?? String(e)).slice(0, 200)}`); }
  const snapB = await daemonSnap();
  const ΔB = r2(snapB.totalSent - snapA.totalSent);
  console.log(`  POST(B): totalSent=${$(snapB.totalSent)} Δ=${$(ΔB)} completed=${snapB.completed} processing=${snapB.processing}`);

  // Step2: daemon tick #1 (picks up any leftover processing rows from S3 payouts batch earlier)
  console.log('\n--- STEP 2: Daemon tick #1 N-1 (cleanup any processing) ---');
  const t1 = await daemonMain();
  const snapC = await daemonSnap();
  const ΔC = r2(snapC.totalSent - snapB.totalSent);
  console.log(`  POST(C): totalSent=${$(snapC.totalSent)} Δ=${$(ΔC)} completed=${snapC.completed} processing=${snapC.processing}`);

  // Step3: daemon tick #2 (expect IDEMPOTENT Δ<0.02)
  console.log('\n--- STEP 3: Daemon tick #2 IDEMPOTENCY #1 (expect Δ<0.02) ---');
  const t2 = await daemonMain();
  const snapD = await daemonSnap();
  const ΔD = r2(snapD.totalSent - snapC.totalSent);
  const passId1 = Math.abs(ΔD) < 0.02;
  console.log(`  POST(D): totalSent=${$(snapD.totalSent)} Δ=${$(ΔD)}  ${passId1 ? 'IDEM1 PASS ✅' : 'IDEM1 FAIL ❌'}  completed=${snapD.completed} processing=${snapD.processing}`);

  // Step4: daemon tick #3 (expect IDEMPOTENT Δ<0.02)
  console.log('\n--- STEP 4: Daemon tick #3 IDEMPOTENCY #2 (expect Δ<0.02) ---');
  const t3 = await daemonMain();
  const snapE = await daemonSnap();
  const ΔE = r2(snapE.totalSent - snapD.totalSent);
  const passId2 = Math.abs(ΔE) < 0.02;
  console.log(`  POST(E): totalSent=${$(snapE.totalSent)} Δ=${$(ΔE)}  ${passId2 ? 'IDEM2 PASS ✅' : 'IDEM2 FAIL ❌'}  completed=${snapE.completed} processing=${snapE.processing} needsManual=${snapE.needsManual}`);

  // Summary
  console.log('\n======== SUMMARY v3.5.2 MINI ========');
  const totalΔ = r2(snapE.totalSent - snapA.totalSent);
  console.log(`  OVERALL totalSent ΔPRE(A)→POST(E) = ${$(totalΔ)}`);
  console.log(`  A PRE  : totalSent=${$(snapA.totalSent)} completed=${snapA.completed}`);
  console.log(`  E POST : totalSent=${$(snapE.totalSent)} completed=${snapE.completed}  processing=${snapE.processing}  needsManual=${snapE.needsManual}`);
  console.log(`  PO seed+settle: seed=${seed?.ok ? '✅' : (seed?.reason ?? 'SKIP')}  advance=${(adv?.finalStatus === 'settled' || (adv?.advanced ?? []).length > 0) ? '✅ (' + (adv?.advancedStatuses?.join(',') ?? '') + ')' : (adv?.skippedReason ?? adv?.error ?? 'NA')}`);
  console.log(`  Idempotency 2×pass: ${passId1 && passId2 ? '✅ BOTH' : '❌ FAILS'} (Δ1=${ΔD}, Δ2=${ΔE}  threshold=0.02)`);

  // Write artifact
  try {
    const fs = await import('node:fs');
    fs.mkdirSync('data/out', { recursive: true });
    fs.appendFileSync('data/out/auto-run-v352-mini-report.ndjson', JSON.stringify({
      startedAt: new Date().toISOString(), policyActive: handsFreePolicyActive(),
      snapA, snapE, totalΔ,
      po: { ok: seed?.ok, reason: seed?.reason, poId: seed?.poId, itemId: seed?.itemId },
      settle: { finalStatus: adv?.finalStatus, advanced: adv?.advanced ?? [], skipped: adv?.skippedReason, err: adv?.error },
      idempotency: { d1: ΔD, d2: ΔE, pass1: passId1, pass2: passId2, threshold: 0.02 },
      exit: { t1, t2, t3 },
    }) + '\n');
    console.log('  report → data/out/auto-run-v352-mini-report.ndjson');
  } catch (_) { }
  await db.$disconnect().catch(() => { });
  await prisma.$disconnect().catch(() => { });
  return (passId1 && passId2) ? 0 : 5;
}

if (typeof require !== 'undefined' ? require.main === module : import.meta.url?.endsWith(process.argv[1]?.replace(/\\/g, '/'))) {
  main().then((c) => process.exit(c ?? 0)).catch((e) => { console.error(e); process.exit(98); });
}
export { main, seedOwnerPo };
