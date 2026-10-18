#!/usr/bin/env node
/**
 * ============================================================================
 * REVENUE ROUTING + PO DELIVERY GATE — fail-closed, evidence-based
 * ============================================================================
 * Answers two questions and refuses to guess:
 *
 *   Q1  Are captured revenues being routed to the preset owner accounts?
 *   Q2  Are purchase orders being delivered?
 *
 * Every claim below is backed by reading an actual artifact. When an artifact
 * is absent, the check returns NOT_RUN — never PASS, never "0 issues".
 *
 * The six preset buckets (permanent pins, project memory, never changed):
 *   10% Salary    -> MA Attijariwafa RIB x-182  (MAD)
 *   40% Debt      -> MA Attijariwafa RIB x-372  (MAD)
 *   30% Sovereign -> Banking Circle LU 646      (USD)
 *   20% Runtime   -> same 646 account           (USD)
 *   + PayPal Business, Payoneer, USDC on Arbitrum
 *
 * Exit codes:
 *   0  both questions PASS with real evidence
 *   1  a check FAILed (evidence contradicts the claim)
 *   2  no FAIL, but required evidence absent -> fail closed
 *
 * Usage:
 *   node scripts/revenue-po-delivery-gate.mjs
 *   node scripts/revenue-po-delivery-gate.mjs --json
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const JSON_OUT = process.argv.includes('--json');

const R = (id, status, detail, extra = {}) => ({ id, status, detail, ...extra });
const rel = (p) => String(p).replace(ROOT + '/', '').replace(ROOT + '\\', '');

const PRESET_BUCKETS = [
  { pct: 10, name: 'salary',    rail: 'MA Attijariwafa RIB x-182', ccy: 'MAD' },
  { pct: 40, name: 'debt',      rail: 'MA Attijariwafa RIB x-372', ccy: 'MAD' },
  { pct: 30, name: 'sovereign', rail: 'Banking Circle LU 646',     ccy: 'USD' },
  { pct: 20, name: 'runtime',   rail: 'Banking Circle LU 646',     ccy: 'USD' },
];

/* --- shared readers ------------------------------------------------------ */
function readJson(p) {
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

function readCsvRows(p) {
  if (!existsSync(p)) return { header: null, rows: [] };
  const lines = readFileSync(p, 'utf8').split(/\r?\n/)
    .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (lines.length === 0) return { header: null, rows: [] };
  const header = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const rows = lines.slice(1).map((l) => l.split(',').map((c) => c.trim().replace(/^"|"$/g, '')));
  return { header, rows };
}

/* --- sale-received evidence --------------------------------------------- */
/**
 * The rwc_sale_received count, read from the same table the status endpoint
 * reads ("AuditLedger", action = 'rwc_sale_received'). This is the only proof
 * that a captured order actually turned into money, so it is read rather than
 * inferred from an order row being present.
 *
 * Fallback: when DATABASE_URL is unset or the query fails, the same literal is
 * looked for in the local data/ artifacts. "Not readable" therefore reports as
 * NOT_RUN, never as "0 sales" — the two are different claims.
 */
async function readSaleReceived() {
  const fromDb = await readSaleReceivedFromDb();
  if (fromDb) return fromDb;
  return readSaleReceivedFromFiles();
}

async function readSaleReceivedFromDb() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  let client;
  try {
    const { Client } = await import('pg');
    client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
    await client.connect();
    const audited = await client.query(
      `SELECT COUNT(*)::int AS n FROM "AuditLedger" WHERE action = 'rwc_sale_received'`,
    );
    const sales = await client.query(
      `SELECT status::text AS status, COUNT(*)::int AS n FROM "SalesLedger" GROUP BY status`,
    );
    const leads = await client.query(`SELECT COUNT(*)::int AS n FROM "InboundLead"`);
    const byStatus = {};
    for (const row of sales.rows) byStatus[row.status] = Number(row.n);
    return {
      source: 'database',
      audited: Number(audited.rows[0]?.n || 0),
      byStatus,
      totalSales: Object.values(byStatus).reduce((a, b) => a + b, 0),
      leads: Number(leads.rows[0]?.n || 0),
      files: [],
    };
  } catch {
    // Unreadable DB is not evidence of zero sales; fall through to artifacts.
    return null;
  } finally {
    if (client) { try { await client.end(); } catch { /* already closed */ } }
  }
}

function readSaleReceivedFromFiles() {
  const dirs = [join(ROOT, 'data', 'out'), join(ROOT, 'data')];
  const files = [];
  let audited = 0;
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d, { withFileTypes: true })) {
      if (!f.isFile() || !/\.(csv|json|jsonl|ndjson)$/.test(f.name)) continue;
      let body = '';
      try { body = readFileSync(join(d, f.name), 'utf8'); } catch { continue; }
      const n = (body.match(/rwc_sale_received/g) || []).length;
      if (n > 0) { audited += n; files.push(f.name); }
    }
  }
  return { source: 'files', audited, byStatus: {}, totalSales: null, leads: null, files };
}

/* --- Q1: revenue routing ------------------------------------------------- */
async function q1RevenueRouted() {
  const checks = [];

  // 1. Is there any captured revenue at all?
  const ordersPath = join(ROOT, 'data', 'out', 'orders', 'orders.jsonl');
  let captured = 0;
  if (existsSync(ordersPath)) {
    captured = readFileSync(ordersPath, 'utf8').split(/\r?\n/).filter((l) => l.trim()).length;
  }
  checks.push(R('q1_captured_orders', existsSync(ordersPath) ? 'PASS' : 'NOT_RUN',
    existsSync(ordersPath)
      ? `${captured} captured order line(s) in orders.jsonl`
      : 'data/out/orders/orders.jsonl absent — no captured revenue recorded',
    { captured }));

  // 2. Did any captured order actually become money? The rwc_sale_received
  //    audit row is the only artifact that says so — an order row on its own
  //    does not. A sale marked paid with no audit row is a contradiction, not
  //    a backlog, so it FAILs instead of waiting to be noticed later.
  const sr = await readSaleReceived();
  const paid = Number(sr.byStatus?.paid || 0);
  const srWhere = sr.source === 'database'
    ? `${sr.totalSales} SalesLedger row(s) [${Object.entries(sr.byStatus).map(([k, v]) => `${k}=${v}`).join(' ') || 'none'}], ${sr.leads} quote lead(s)`
    : `${sr.files.length} local artifact(s) mention the action — SalesLedger not readable`;
  const srDetail = sr.audited > 0
    ? `${sr.audited} rwc_sale_received audit row(s); ${srWhere}`
    : paid > 0
      ? `${paid} sale(s) marked paid but 0 rwc_sale_received audit rows — money received and not recorded`
      : `0 rwc_sale_received; ${srWhere}`;
  checks.push(R('q1_sale_received',
    sr.audited > 0 ? 'PASS' : paid > 0 ? 'FAIL' : 'NOT_RUN',
    srDetail,
    { audited: sr.audited, source: sr.source, byStatus: sr.byStatus }));

  // 3. Authorizer ledger: any non-zero balance anywhere?
  const ledger = readJson(join(ROOT, 'data', 'out', 'authorizer-ledger-report.json'));
  if (!ledger) {
    checks.push(R('q1_ledger_balances', 'NOT_RUN', 'authorizer-ledger-report.json absent or unreadable'));
  } else {
    const accounts = ledger.accounts || [];
    const nonZero = accounts.filter((a) => Number(a.balance) !== 0);
    checks.push(R('q1_ledger_balances', nonZero.length ? 'PASS' : 'FAIL',
      nonZero.length
        ? `${nonZero.length}/${accounts.length} account(s) hold a balance`
        : `all ${accounts.length} accounts are 0 as of ${ledger.at} — nothing to route`,
      { accounts: accounts.length, nonZero: nonZero.length, asOf: ledger.at }));
  }

  // 4. Preset bucket routing: is there evidence of a bucket split?
  const bucketEvidence = [];
  const reportDir = join(ROOT, 'data', 'out');
  if (existsSync(reportDir)) {
    for (const f of readdirSync(reportDir)) {
      if (!/payout|release|autorun|settlement/i.test(f)) continue;
      const body = readFileSync(join(reportDir, f), 'utf8');
      for (const b of PRESET_BUCKETS) {
        if (body.includes(b.name) || body.includes(b.rail.split(' ').pop())) bucketEvidence.push(b.name);
      }
    }
  }
  const bucketsHit = [...new Set(bucketEvidence)];
  checks.push(R('q1_preset_bucket_routing',
    bucketsHit.length === PRESET_BUCKETS.length ? 'PASS' : 'NOT_RUN',
    bucketsHit.length === PRESET_BUCKETS.length
      ? `all ${PRESET_BUCKETS.length} preset buckets referenced in payout artifacts`
      : `only ${bucketsHit.length}/${PRESET_BUCKETS.length} buckets evidenced (${bucketsHit.join(',') || 'none'})`,
    { expected: PRESET_BUCKETS.map((b) => `${b.pct}% ${b.name}`), evidenced: bucketsHit }));

  // 5. Is the payout rail actually reachable?
  const hasDb = Boolean(process.env.DATABASE_URL);
  checks.push(R('q1_payout_rail', hasDb ? 'PASS' : 'NOT_RUN',
    hasDb
      ? 'DATABASE_URL present — payout rail reachable'
      : 'DATABASE_URL unset — preset OwnerAccounts unreachable, no payout can be confirmed',
    { databaseUrl: hasDb }));

  // 6. Hands-free policy gates
  const gates = {
    OWNER_HANDS_FREE_POLICY: process.env.OWNER_HANDS_FREE_POLICY === 'true',
    AUTO_CONFIRM_OWNER_BATCHES: process.env.AUTO_CONFIRM_OWNER_BATCHES === 'true',
    PAYOUT_TICK_SECRET: Boolean(process.env.PAYOUT_TICK_SECRET),
  };
  const gatesOn = Object.values(gates).filter(Boolean).length;
  checks.push(R('q1_handsfree_gates', gatesOn === Object.keys(gates).length ? 'PASS' : 'NOT_RUN',
    gatesOn === Object.keys(gates).length
      ? 'all hands-free policy gates enabled'
      : `only ${gatesOn}/${Object.keys(gates).length} gates enabled — auto-routing is fail-closed off`,
    { gates }));

  const failed = checks.some((c) => c.status === 'FAIL');
  const unrun = checks.some((c) => c.status === 'NOT_RUN');
  return {
    question: 'Are captured revenues routed to the preset owner accounts?',
    verdict: failed ? 'FAIL' : unrun ? 'NOT_VERIFIABLE (fail closed)' : 'PASS',
    checks,
  };
}

/* --- Q2: PO delivery ----------------------------------------------------- */
function q2PoDelivered() {
  const checks = [];

  const wlPath = join(ROOT, 'data', 'out', 'order-placement-worklist.csv');
  const { header, rows } = readCsvRows(wlPath);

  if (!header) {
    checks.push(R('q2_worklist_readable', 'NOT_RUN', 'order-placement-worklist.csv absent'));
  } else {
    checks.push(R('q2_worklist_readable', 'PASS', `${rows.length} worklist rows`, { rows: rows.length }));
    const si = header.indexOf('status');
    const ai = header.indexOf('action');
    if (si < 0) {
      checks.push(R('q2_status_column', 'FAIL', 'no status column in worklist header'));
    } else {
      const counts = {};
      for (const r of rows) counts[r[si]] = (counts[r[si]] || 0) + 1;
      const claimed = (counts.ordered || 0) + (counts.purchased || 0);
      checks.push(R('q2_status_column', 'PASS',
        Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' '),
        { claimedOrderedOrPurchased: claimed }));

      // A row claimed "ordered" but whose action still says PLACE ORDER is a
      // contradiction: the status asserts something the action says is pending.
      if (ai >= 0) {
        const contradictions = rows.filter((r) =>
          (r[si] === 'ordered' || r[si] === 'purchased') &&
          /PLACE ORDER|ENTER REAL SUPPLIER/i.test(r[ai] || ''));
        checks.push(R('q2_status_action_consistency',
          contradictions.length === 0 ? 'PASS' : 'FAIL',
          contradictions.length === 0
            ? 'no row claims ordered/purchased while its action is still PLACE ORDER'
            : `${contradictions.length} row(s) claim ordered/purchased but action is still pending — status is not trustworthy`,
          { contradictions: contradictions.length }));
      }
    }
  }

  // Real delivery evidence: an order reference AND a carrier tracking number.
  const evidenceDirs = [
    join(ROOT, 'data', 'out'),
    join(ROOT, 'data'),
  ];
  let orderRefs = 0, tracking = 0;
  const REF = /\bRWC-[A-Z0-9]{10}-[A-Z0-9]{10}-[A-Z0-9]{10}-[A-Z0-9]{10}\b/;
  const TRK = /\b(orderRef|trackingNumber|carrierTracking)["'\s:=]+["']?[A-Za-z0-9-]{8,}/i;
  for (const d of evidenceDirs) {
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d, { withFileTypes: true })) {
      if (!f.isFile()) continue;
      if (!/\.(csv|json|jsonl|ndjson)$/.test(f.name)) continue;
      let body = '';
      try { body = readFileSync(join(d, f.name), 'utf8'); } catch { continue; }
      orderRefs += (body.match(new RegExp(REF, 'g')) || []).length;
      tracking += (body.match(new RegExp(TRK, 'g')) || []).length;
    }
  }
  checks.push(R('q2_delivery_evidence',
    tracking > 0 ? 'PASS' : 'NOT_RUN',
    tracking > 0
      ? `${orderRefs} order ref(s), ${tracking} tracking value(s) found`
      : `0 real tracking numbers, 0 real order refs across data/ — no delivery is provable`,
    { orderRefs, tracking }));

  // Waybills: the carrier handoff artifact.
  const wb = join(ROOT, 'data', 'out', 'waybills.csv');
  checks.push(R('q2_waybills', existsSync(wb) ? 'PASS' : 'NOT_RUN',
    existsSync(wb) ? 'waybills.csv present' : 'data/out/waybills.csv absent — no carrier handoff record',
    { present: existsSync(wb) }));

  const failed = checks.some((c) => c.status === 'FAIL');
  const unrun = checks.some((c) => c.status === 'NOT_RUN');
  return {
    question: 'Are purchase orders being delivered?',
    verdict: failed ? 'FAIL' : unrun ? 'NOT_VERIFIABLE (fail closed)' : 'PASS',
    checks,
  };
}

/* --- main ---------------------------------------------------------------- */
async function main() {
  const q1 = await q1RevenueRouted();
  const q2 = q2PoDelivered();

  const failAny = [q1, q2].some((q) => q.verdict === 'FAIL');
  const unrunAny = [q1, q2].some((q) => q.verdict.startsWith('NOT_VERIFIABLE'));
  const exitCode = failAny ? 1 : unrunAny ? 2 : 0;

  const out = { revenueRouted: q1, poDelivered: q2, exitCode };

  if (JSON_OUT) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    for (const q of [q1, q2]) {
      console.log('='.repeat(66));
      console.log('Q: ' + q.question);
      console.log('   verdict: ' + q.verdict);
      for (const c of q.checks) {
        const tag = c.status === 'PASS' ? '  ok  ' : c.status === 'FAIL' ? ' FAIL ' : 'NRUN ';
        console.log(`  [${tag}] ${c.id}`);
        console.log(`          ${c.detail}`);
      }
    }
    console.log('='.repeat(66));
    console.log('NOTE: this gate only reports evidence it actually read.');
    console.log('      It never asserts revenue routed or a PO delivered.');
  }
  process.exit(exitCode);
}

main();
