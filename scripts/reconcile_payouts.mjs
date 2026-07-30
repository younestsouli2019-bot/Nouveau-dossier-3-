#!/usr/bin/env node
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';

const REPO_ROOT = process.env.REPO_ROOT || process.cwd();
const BAK_PATH  = path.join(REPO_ROOT, '.base44-offline-store.json.bak');
const LIVE_PATH = path.join(REPO_ROOT, '.autonomous-offline-store.json');
const STATE_PATH = path.join(REPO_ROOT, '.autonomous-state.json');
const SWARM_DIR = path.join(REPO_ROOT, '.swarm');
const RECONCILE_DIR = path.join(REPO_ROOT, 'data', 'security');

const DRY_RUN = process.argv.includes('--dry-run');
const RECONCILED_AT = new Date().toISOString();
const RECONCILE_RUN_ID = `RECONCILE_${Date.now()}`;

const SAFE_GATEWAY_REF_PREFIX = 'FILE:';

const log = (...a) => console.log(`[${RECONCILE_RUN_ID}]`, ...a);
const logw = (...a) => console.warn(`[${RECONCILE_RUN_ID}] WARN:`, ...a);

async function readJSON(p, fallback) {
  if (!existsSync(p)) return fallback;
  try { return JSON.parse(await fs.readFile(p, 'utf-8')); }
  catch (e) { logw(`Failed to parse ${p}: ${e.message}`); return fallback; }
}

async function writeJSONAtomic(p, obj) {
  mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf-8');
  await fs.rename(tmp, p);
}

function sumByStatus(records) {
  return records.reduce((a, r) => {
    const s = r.status || '?';
    a[s] = a[s] || { count: 0, total: 0 };
    a[s].count++;
    a[s].total += Number(r.amount || r.total_amount || 0);
    return a;
  }, {});
}

function classifyBatch(b, itemCount) {
  if (b.status === 'pending_approval' && itemCount === 0) return 'ghost_approval';
  if (b.status === 'pending_approval' && itemCount > 0) return 'pending_approval_live';
  if (b.status === 'pending_external_confirmation') {
    const ref = b.gateway_ref || '';
    if (ref.startsWith(SAFE_GATEWAY_REF_PREFIX)) return 'pending_ext_file_handoff';
    if (ref && ref.trim()) return 'pending_ext_real_gateway';
    return 'pending_ext_no_ref';
  }
  if (/settled|completed|paid|confirmed/i.test(b.status || '')) return 'already_settled';
  if (/fail/i.test(b.status || '')) return 'already_failed';
  if (/recoverable/i.test(b.status || '')) return 'already_reconciled';
  return 'other';
}

async function phase1_loadAndSnapshot() {
  log('Phase 1: Loading stores and snapshotting pre-reconciliation state.');
  const bak = await readJSON(BAK_PATH, { entities: {} });
  const live = await readJSON(LIVE_PATH, { entities: {} });
  const state = await readJSON(STATE_PATH, { frozenSince: null, freeze: { active: false, reason: null } });

  const bakBatches = (bak.entities.PayoutBatch && bak.entities.PayoutBatch.records) || [];
  const bakItems   = (bak.entities.PayoutItem   && bak.entities.PayoutItem.records)   || [];
  const bakEarn    = (bak.entities.Earning      && bak.entities.Earning.records)      || [];
  const liveEarn   = (live.entities.Earning     && live.entities.Earning.records)     || [];
  const liveBatches= (live.entities.PayoutBatch && live.entities.PayoutBatch.records) || [];
  const liveItems  = (live.entities.PayoutItem  && live.entities.PayoutItem.records)  || [];

  const perBatchCount = {};
  bakItems.forEach(i => { perBatchCount[i.batch_id] = (perBatchCount[i.batch_id] || 0) + 1; });

  const classifications = bakBatches.map(b => ({
    batch_id: b.batch_id, status: b.status, total: Number(b.total_amount || 0),
    gateway_ref: b.gateway_ref || '', items: perBatchCount[b.batch_id] || 0,
    class: classifyBatch(b, perBatchCount[b.batch_id] || 0),
  }));

  const summary = {
    bak: {
      PayoutBatch: sumByStatus(bakBatches), PayoutItem: sumByStatus(bakItems), Earning: sumByStatus(bakEarn),
      totals: {
        batch_count: bakBatches.length, item_count: bakItems.length, earning_count: bakEarn.length,
        batch_total_usd: bakBatches.reduce((s, b) => s + Number(b.total_amount || 0), 0),
        item_total_usd: bakItems.reduce((s, b) => s + Number(b.amount || 0), 0),
        earning_total_usd: bakEarn.reduce((s, b) => s + Number(b.amount || 0), 0),
      },
    },
    live: {
      PayoutBatch: sumByStatus(liveBatches), PayoutItem: sumByStatus(liveItems), Earning: sumByStatus(liveEarn),
      totals: { batch_count: liveBatches.length, item_count: liveItems.length, earning_count: liveEarn.length },
    },
    classification_counts: classifications.reduce((a, c) => { a[c.class] = (a[c.class] || 0) + 1; return a; }, {}),
    state,
  };

  log(`  bak: ${bakBatches.length} batches, ${bakItems.length} items, ${bakEarn.length} earnings`);
  log(`  live: ${liveBatches.length} batches, ${liveItems.length} items, ${liveEarn.length} earnings`);
  log(`  classification: ${JSON.stringify(summary.classification_counts)}`);
  return { bak, live, state, bakBatches, bakItems, bakEarn, liveEarn, liveBatches, liveItems, classifications, summary };
}

async function phase2_validateNoLossInvariants(ctx) {
  log('Phase 2: Validating no-loss invariants.');
  const { bakBatches, bakItems } = ctx;
  const violations = [];

  for (const b of bakBatches) {
    const ref = b.gateway_ref || '';
    if (ref && !ref.startsWith(SAFE_GATEWAY_REF_PREFIX) && ref.trim() !== '') {
      violations.push({ rule: 'INV-1', batch_id: b.batch_id, detail: `gateway_ref is not a file-handoff: ${ref}` });
    }
  }
  for (const b of bakBatches) {
    if (/settled|completed|paid|confirmed/i.test(b.status || '')) {
      violations.push({ rule: 'INV-2', batch_id: b.batch_id, detail: `batch already settled: ${b.status}` });
    }
  }
  const batchIds = new Set(bakBatches.map(b => b.batch_id));
  for (const i of bakItems) {
    if (!batchIds.has(i.batch_id)) {
      violations.push({ rule: 'INV-3', item_id: i.item_id, detail: `orphan item, batch ${i.batch_id} missing` });
    }
  }
  const perBatchSum = {};
  bakItems.forEach(i => { perBatchSum[i.batch_id] = (perBatchSum[i.batch_id] || 0) + Number(i.amount || 0); });
  for (const b of bakBatches) {
    const itemCount = bakItems.filter(i => i.batch_id === b.batch_id).length;
    if (itemCount === 0) continue;
    const itemSum = perBatchSum[b.batch_id] || 0;
    const batchTotal = Number(b.total_amount || 0);
    if (Math.abs(itemSum - batchTotal) > 0.01) {
      violations.push({ rule: 'INV-4', batch_id: b.batch_id, detail: `item sum ${itemSum.toFixed(2)} != batch total ${batchTotal.toFixed(2)}` });
    }
  }
  for (const b of bakBatches) if (b.currency !== 'USD') violations.push({ rule: 'INV-5', batch_id: b.batch_id, detail: `non-USD currency: ${b.currency}` });
  for (const i of bakItems) if (i.currency !== 'USD') violations.push({ rule: 'INV-5', item_id: i.item_id, detail: `non-USD currency: ${i.currency}` });

  if (violations.length) {
    logw(`INVARIANTS FAILED: ${violations.length} violation(s). Aborting.`);
    violations.slice(0, 10).forEach(v => logw(`  [${v.rule}] ${JSON.stringify(v)}`));
    return { ok: false, violations };
  }
  log('  All no-loss invariants hold. Safe to proceed.');
  return { ok: true, violations: [] };
}

async function phase3_applyReconciliation(ctx) {
  log('Phase 3: Applying reconciliation transforms.');
  const { bakBatches, bakItems, bakEarn, live, state, classifications } = ctx;
  const now = RECONCILED_AT;

  const newBatches = bakBatches.map(b => {
    const cls = classifications.find(c => c.batch_id === b.batch_id);
    let newStatus = b.status;
    let recoveryNote = null;

    if (cls.class === 'ghost_approval') {
      newStatus = 'cancelled_ghost';
      recoveryNote = { action: 'GHOST_CANCEL', reason: '0-item pending_approval batch, no funds tied', at: now, run_id: RECONCILE_RUN_ID };
    } else if (['pending_approval_live', 'pending_ext_file_handoff', 'pending_ext_no_ref'].includes(cls.class)) {
      newStatus = 'failed_recoverable';
      recoveryNote = { action: 'RESET_TO_RECOVERABLE', reason: `batch in ${b.status} via FILE: handoff; never confirmed externally`, at: now, run_id: RECONCILE_RUN_ID };
    } else {
      recoveryNote = { action: 'SKIP', reason: `already in terminal state: ${b.status}`, at: now, run_id: RECONCILE_RUN_ID };
    }
    return { ...b, status: newStatus, updated_date: now, _reconciliation: recoveryNote };
  });

  const batchStatusMap = new Map(newBatches.map(b => [b.batch_id, b.status]));
  const newItems = bakItems.map(i => {
    let newStatus = i.status;
    const ps = batchStatusMap.get(i.batch_id);
    if (ps === 'failed_recoverable') newStatus = 'failed_recoverable';
    else if (ps === 'cancelled_ghost') newStatus = 'cancelled_ghost';
    return { ...i, status: newStatus, updated_date: now, _reconciliation: { at: now, run_id: RECONCILE_RUN_ID, parent_batch_status: ps } };
  });

  const mergedEarnMap = new Map();
  for (const e of bakEarn) mergedEarnMap.set(e.earning_id, e);
  for (const e of ctx.liveEarn) { if (!mergedEarnMap.has(e.earning_id)) mergedEarnMap.set(e.earning_id, e); }
  const newEarn = Array.from(mergedEarnMap.values()).map(e => {
    if (e.status === 'settled_externally_pending') {
      return { ...e, status: 'recoverable', updated_date: now, _reconciliation: { action: 'DOWNGRADE_TO_RECOVERABLE', at: now, run_id: RECONCILE_RUN_ID } };
    }
    return e;
  });

  const newLive = {
    ...live,
    entities: { ...(live.entities || {}), Earning: { records: newEarn }, PayoutBatch: { records: newBatches }, PayoutItem: { records: newItems } },
    _reconciliation_meta: { run_id: RECONCILE_RUN_ID, reconciled_at: now, dry_run: DRY_RUN },
  };

  const newState = {
    ...state,
    freeze: { active: true, reason: `PAYOUT_RECONCILIATION:${RECONCILE_RUN_ID}`, since: now, notes: 'Payouts reconciled to failed_recoverable.' },
    lastRecoveryAt: now, recoveryAction: 'PAYOUT_RECONCILIATION', reconciliationRunId: RECONCILE_RUN_ID, updatedAt: now,
  };

  const postSummary = {
    PayoutBatch: sumByStatus(newBatches), PayoutItem: sumByStatus(newItems), Earning: sumByStatus(newEarn),
    totals: {
      batch_count: newBatches.length, item_count: newItems.length, earning_count: newEarn.length,
      batch_total_usd: newBatches.reduce((s, b) => s + Number(b.total_amount || 0), 0),
      item_total_usd: newItems.reduce((s, b) => s + Number(b.amount || 0), 0),
      earning_total_usd: newEarn.reduce((s, b) => s + Number(b.amount || 0), 0),
    },
    recoverable_amount_usd: newItems.filter(i => i.status === 'failed_recoverable').reduce((s, i) => s + Number(i.amount || 0), 0),
    cancelled_ghost_amount_usd: newBatches.filter(b => b.status === 'cancelled_ghost').reduce((s, b) => s + Number(b.total_amount || 0), 0),
  };

  log(`  Recoverable amount: $${postSummary.recoverable_amount_usd.toFixed(2)} USD`);
  return { newLive, newState, postSummary, newBatches, newItems, newEarn };
}

async function phase4_persist(ctx, reconResult) {
  log('Phase 4: Persisting changes.');
  const { newLive, newState, postSummary } = reconResult;

  if (DRY_RUN) { log('  DRY-RUN: no files written.'); return; }

  mkdirSync(SWARM_DIR, { recursive: true });
  mkdirSync(RECONCILE_DIR, { recursive: true });

  if (existsSync(LIVE_PATH)) {
    await fs.copyFile(LIVE_PATH, path.join(SWARM_DIR, `autonomous-offline-store.pre-reconcile.${RECONCILE_RUN_ID}.json`));
  }
  if (existsSync(STATE_PATH)) {
    await fs.copyFile(STATE_PATH, path.join(SWARM_DIR, `autonomous-state.pre-reconcile.${RECONCILE_RUN_ID}.json`));
  }

  await writeJSONAtomic(LIVE_PATH, newLive);
  await writeJSONAtomic(STATE_PATH, newState);

  const report = {
    run_id: RECONCILE_RUN_ID, reconciled_at: RECONCILED_AT, dry_run: DRY_RUN,
    pre_reconciliation: ctx.summary, post_reconciliation: postSummary,
    invariants_passed: ctx.invariants?.ok ?? true,
  };

  const reportPath = path.join(RECONCILE_DIR, `reconciliation-report-${RECONCILE_RUN_ID}.json`);
  await writeJSONAtomic(reportPath, report);
  await writeJSONAtomic(path.join(RECONCILE_DIR, 'reconciliation-report-latest.json'), report);
  log(`  Report: ${reportPath}`);
  return { report, reportPath };
}

async function main() {
  log(`Payout Reconciliation — DRY_RUN=${DRY_RUN}`);

  const ctx = await phase1_loadAndSnapshot();
  const inv = await phase2_validateNoLossInvariants(ctx);
  ctx.invariants = inv;
  if (!inv.ok) { log('Invariants failed — aborting.'); process.exit(2); }

  const reconResult = await phase3_applyReconciliation(ctx);
  await phase4_persist(ctx, reconResult);

  log('=== RECONCILIATION COMPLETE ===');
  log(`  Batches: ${reconResult.newBatches.length}`);
  log(`  Items:   ${reconResult.newItems.length}`);
  log(`  Recoverable: $${reconResult.postSummary.recoverable_amount_usd.toFixed(2)} USD`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
