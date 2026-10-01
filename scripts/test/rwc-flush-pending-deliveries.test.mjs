#!/usr/bin/env node
/**
 * Integration test suite for scripts/rwc-flush-pending-deliveries.mjs
 *
 * Run:  node scripts/test/rwc-flush-pending-deliveries.test.mjs
 *
 * Spins up a mock Resend HTTP server in-process (ephemeral port), builds
 * ledger fixtures in a temp dir, and drives the replay script through five
 * scenarios via child_process:
 *
 *  T1 fail-closed  — no RESEND_API_KEY, no --dry-run → exit 1, ledger untouched
 *  T2 dry-run      — reports pending, ledger byte-identical
 *  T3 live flush   — PENDING→SENT for valid orders; provider-500 order stays
 *                     PENDING; no-email order skipped; SENT untouched;
 *                     malformed line preserved
 *  T4 idempotency  — rerun re-sends nothing for SENT orders
 *  T5 outage       — provider down → order stays PENDING, exit 0, retryable
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '..', 'rwc-flush-pending-deliveries.mjs');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

// ---- mock Resend -----------------------------------------------------------
const received = [];
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let to = '';
    try { to = JSON.parse(body).to?.[0] ?? ''; } catch { /* ignore */ }
    received.push(String(to));
    const fail = String(to).startsWith('fail@') || String(to).startsWith('outage@');
    res.writeHead(fail ? 500 : 200, { 'Content-Type': 'application/json' });
    res.end(fail ? '{"error":"mock failure"}' : '{"id":"email-123"}');
  });
});

function runFlush(env, args = []) {
  // NOTE: must be async (spawn, not spawnSync) — the mock server lives in
  // this same process; a synchronous spawn would block its event loop and
  // deadlock the child's HTTP requests against the mock.
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

function ledgerFixture() {
  return [
    JSON.stringify({ ts: '2026-10-01T08:00:00Z', session_id: 'cs_sent_001', email: 'already@done.com', slug: 'slug-a', title: 'Course A', amount_total: 19, currency: 'usd', status: 'PAID', delivery: 'SENT', delivery_detail: '' }),
    JSON.stringify({ ts: '2026-10-01T08:01:00Z', session_id: 'cs_pending_002', email: 'buyer@example.com', slug: 'slug-b', title: 'Course B', amount_total: 19, currency: 'usd', status: 'PAID', delivery: 'PENDING', delivery_detail: 'RESEND_API_KEY not set' }),
    JSON.stringify({ ts: '2026-10-01T08:02:00Z', session_id: 'cs_pending_003', email: 'other@example.com', slug: 'slug-c', title: 'Course C', amount_total: 19, currency: 'usd', status: 'PAID', delivery: 'PENDING', delivery_detail: 'RESEND_API_KEY not set' }),
    JSON.stringify({ ts: '2026-10-01T08:03:00Z', session_id: 'cs_fail_004', email: 'fail@example.com', slug: 'slug-d', title: 'Course D', amount_total: 19, currency: 'usd', status: 'PAID', delivery: 'PENDING', delivery_detail: '' }),
    JSON.stringify({ ts: '2026-10-01T08:04:00Z', session_id: 'cs_noemail_005', email: '', slug: 'slug-e', title: 'Course E', amount_total: 19, currency: 'usd', status: 'PAID', delivery: 'PENDING', delivery_detail: 'buyer email missing' }),
    'not json at all — malformed line',
    '',
  ].join('\n');
}

function readLedger(p) {
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
}

function findBySession(p, id) {
  for (const line of readLedger(p)) {
    try {
      const o = JSON.parse(line);
      if (o.session_id === id) return o;
    } catch { /* skip malformed */ }
  }
  return null;
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rwc-flush-test-'));
  const ledger = path.join(tmp, 'ledger.ndjson');
  fs.writeFileSync(ledger, ledgerFixture(), 'utf8');
  const original = fs.readFileSync(ledger, 'utf8');

  await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${mock.address().port}/emails`;
  const live = (extra = {}) => runFlush(
    { RWC_ORDERS_LEDGER: ledger, RESEND_API_KEY: 'rk_test_mock', RWC_RESEND_ENDPOINT: endpoint, ...extra },
    extra.__args ?? []);

  // T1: fail-closed
  const t1 = await runFlush({ RWC_ORDERS_LEDGER: ledger });
  check('T1 no key → exit 1', t1.status === 1, `exit=${t1.status}`);
  check('T1 ledger untouched', fs.readFileSync(ledger, 'utf8') === original);

  // T2: dry-run
  const t2 = await runFlush({ RWC_ORDERS_LEDGER: ledger }, ['--dry-run']);
  check('T2 dry-run → exit 0', t2.status === 0, `exit=${t2.status}`);
  check('T2 reports pending', t2.stdout.includes('would send to buyer@example.com') && t2.stdout.includes('would send to other@example.com'));
  check('T2 ledger untouched', fs.readFileSync(ledger, 'utf8') === original);
  check('T2 no live sends', received.length === 0);

  // T3: live flush
  const t3 = await live();
  check('T3 exit 0', t3.status === 0, `exit=${t3.status}`);
  const b = findBySession(ledger, 'cs_pending_002');
  const c = findBySession(ledger, 'cs_pending_003');
  const f = findBySession(ledger, 'cs_fail_004');
  const no = findBySession(ledger, 'cs_noemail_005');
  check('T3 valid PENDING → SENT', b?.delivery === 'SENT' && c?.delivery === 'SENT');
  check('T3 provider-500 stays PENDING', f?.delivery === 'PENDING');
  check('T3 no-email skipped', no?.delivery === 'PENDING' && !received.includes(''));
  check('T3 SENT untouched', findBySession(ledger, 'cs_sent_001')?.delivery === 'SENT');
  check('T3 malformed line preserved', readLedger(ledger).some((l) => !l.startsWith('{') && l.includes('malformed')));
  const sentAfterT3 = received.length;

  // T4: idempotency
  const t4 = await live();
  // Idempotency = never re-send to an already-SENT recipient. The provider-500
  // order is expected to be retried (and logged by the mock even on failure),
  // so count per-recipient instead of total requests.
  const count = (e) => received.filter((r) => r === e).length;
  check('T4 no re-send to SENT recipients', count('buyer@example.com') === 1 && count('other@example.com') === 1 && count('already@done.com') === 0,
    `buyer=${count('buyer@example.com')} other=${count('other@example.com')}`);
  check('T4 failed recipient retried', count('fail@example.com') >= 2, `attempts=${count('fail@example.com')}`);
  check('T4 failing order retried once', t4.stdout.includes('Pending: 1'));

  // T5: provider outage (kill mock, add fresh pending order)
  fs.appendFileSync(ledger, JSON.stringify({ ts: '2026-10-01T08:10:00Z', session_id: 'cs_outage_006', email: 'outage@example.com', slug: 'slug-f', title: 'Course F', amount_total: 19, currency: 'usd', status: 'PAID', delivery: 'PENDING', delivery_detail: '' }) + '\n');
  await new Promise((resolve) => mock.close(resolve));
  const t5 = await live();
  check('T5 outage → exit 0 (fail-safe)', t5.status === 0, `exit=${t5.status}`);
  const o6 = findBySession(ledger, 'cs_outage_006');
  check('T5 outage order stays PENDING', o6?.delivery === 'PENDING');
  check('T5 flag still marked for retry', t5.stdout.includes('failed: 2') || t5.stdout.includes('failed: 1'));

  fs.rmSync(tmp, { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
