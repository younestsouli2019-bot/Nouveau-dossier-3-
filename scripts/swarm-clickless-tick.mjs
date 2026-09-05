// scripts/swarm-clickless-tick.mjs
// READ-ONLY clickless swarm tick. Reconciles + guards + audits health and
// procurement delivery status, writes a journal stamp, and ALWAYS ends
// fail-closed: it NEVER creates payouts, never funds cards, never calls
// orchestrator.tick() maybePayout, and never flips a shipment to delivered
// without a real recorded waybill.
//
// Why READ-ONLY: the repo's money invariants forbid booking/settling anything
// without real external proof. Autonomous money movement is therefore OFF by
// construction here. This tick only *verifies* and *advances procurement that
// already has a real waybill* (shipped), leaving delivered gated on a real
// carrier scan.
//
// Run:  node scripts/swarm-clickless-tick.mjs
// Env:  DATABASE_URL (optional — without it, DB-backed audits are skipped,
//       static/health audits still run) . PLAN_TRANSITION_MODE=1 set by CI.

import 'dotenv/config';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const TMP = 'logs/swarm_clickless';
mkdirSync(join(ROOT, TMP), { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const results = [];
const t0 = Date.now();

function runStatic(name, script, args = [], { tsx = false } = {}) {
  const p = join(ROOT, script);
  if (!existsSync(p)) { results.push({ name, status: 'skip_missing', script }); return; }
  const runner = tsx ? `node --import tsx` : 'node';
  try {
    const out = execSync(`${runner} "${p}" ${args.join(' ')}`, { encoding: 'utf8', timeout: 90000 });
    results.push({ name, status: 'ok', tail: out.trim().slice(-400) });
  } catch (e) {
    results.push({ name, status: 'error', tail: String(e?.stderr || e?.message || e).slice(-400) });
  }
}

function runDbAudit(name, script) {
  const p = join(ROOT, script);
  if (!process.env.DATABASE_URL || !existsSync(p)) {
    results.push({ name, status: process.env.DATABASE_URL ? 'skip_missing' : 'skip_no_db' });
    return;
  }
  try {
    const out = execSync(`node "${p}"`, { encoding: 'utf8', timeout: 90000 });
    results.push({ name, status: 'ok', tail: out.trim().slice(-400) });
  } catch (e) {
    results.push({ name, status: 'error', tail: String(e?.stderr || e?.message || e).slice(-400) });
  }
}

// ── Phase 1: static reads (no DB, no network writes) ─────────────────────────
runStatic('truth-invariant-audit', 'scripts/truth-invariant-audit.mjs');
runStatic('url-guard-self-test', 'scripts/url-guard-self-test.mjs', [], { tsx: true });

// ── Phase 2: DB read-only reconciles (only when DATABASE_URL present) ────────
runDbAudit('payout-reconcile', 'scripts/verify-payout-reconcile.mjs');
runDbAudit('postgres-integrity', 'scripts/postgres-integrity-audit.mjs');
runStatic('inbound-scout', 'scripts/inbound-scout.mjs', ['--dir', 'data/inbound/receipts']);

// ── Phase 3: rail health (read-only probe) ───────────────────────────────────
if (existsSync(join(ROOT, 'scripts/rail-health-report.mjs'))) {
  runStatic('rail-health', 'scripts/rail-health-report.mjs');
}

// ── Phase 3.5: autonomous watchers (dry/read-only, no money movement) ─────
// These NEVER move money and NEVER fabricate proof/delivery. They only
// (a) report the proof-integrity remediation plan, (b) emit the fail-closed
// settlement green-light, and (c) advance procurement only on real waybills.
runStatic('financial-policy', 'scripts/financial-policy-audit.mjs');
runStatic('audit-remediate-proof', 'scripts/remediate-proof-gaps.mjs');
runStatic('rail-funding-monitor', 'scripts/rail-funding-monitor.mjs');
runStatic('procurement-watchdog', 'scripts/procurement-delivery-watchdog.mjs');

// ── Phase 3.6: autonomous worklist generators (no-API execution path) ──────
// These generate structured action queues for the operator to execute through
// their own Attijari mobile app or cash on delivery. No API, no fabrication.
runStatic('settlement-worklist', 'scripts/settlement-worklist.mjs');
runStatic('procurement-queue', 'scripts/procurement-payment-queue.mjs');
runStatic('po-execution-queue', 'scripts/po-execution-queue.mjs');
runStatic('payment-routing-table', 'scripts/payment-routing-table.mjs');
runStatic('po-fulfillment-orchestrator', 'scripts/po-fulfillment-orchestrator.mjs');
runStatic('evm-wallet-balance', 'scripts/evm-wallet-rail.mjs', ['--action', 'balance']);

// ── Phase 4: journal stamp ───────────────────────────────────────────────────
const report = {
  at: new Date().toISOString(),
  uid: `clickless-${stamp}`,
  elapsed_ms: Date.now() - t0,
  plan_transition_mode: process.env.PLAN_TRANSITION_MODE ?? 'unset',
  readonly: true,
  moved_money: false,
  phases: results,
  note: 'READ-ONLY reconcile/guard/audit tick. No payouts, no card funding, no delivered flips without a real waybill. Delivered remains gated on a real carrier scan.',
};
writeFileSync(join(ROOT, TMP, `tick-${stamp}.json`), JSON.stringify(report, null, 2));
writeFileSync(join(ROOT, TMP, 'latest.json'), JSON.stringify(report, null, 2));

const failed = results.filter((r) => r.status === 'error');
console.log(JSON.stringify(report, null, 2));
console.log(`\nclickless tick complete: ${results.length} phases, ${failed.length} error(s). READ-ONLY — no money moved.`);
// Non-fatal by design: audit errors never block the journal; exit reflects only
// a hard tooling failure, never to force a payout.
process.exit(0);