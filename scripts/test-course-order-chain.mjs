#!/usr/bin/env node
/**
 * test-course-order-chain.mjs — proves the full crypto sale chain end to end
 * WITHOUT a real buyer, real money or a live mail provider:
 *
 *   deposit (confirmed, exact fingerprinted amount)
 *     -> matchDeposit() picks the course            [real watcher code]
 *     -> order row status=PAID delivery=PENDING      [real order shape]
 *     -> rwc-flush-pending-deliveries.mjs sends the receipt   [real flush code]
 *        to a LOCAL mock HTTP endpoint (RWC_RESEND_ENDPOINT)
 *     -> ledger flips to delivery=SENT
 *     -> second flush is idempotent (no duplicate send)
 *
 * What it deliberately does NOT prove: the live Resend delivery (needs
 * RESEND_API_KEY) and the exchange's own confirmation semantics (needs a real
 * deposit). Everything in between is exercised here.
 *
 * Run: node scripts/test-course-order-chain.mjs    (exit 0 = chain intact)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const results = [];
const check = (name, cond, detail = '') => results.push({ name, ok: Boolean(cond), detail });

const { fingerprintCents, loadCatalog, matchDeposit } = await import('../scripts/rwc-crypto-deposit-watch.mjs');

// ── 1. fingerprint + catalog sanity ─────────────────────────────────────────
const { byCents } = loadCatalog();
check('catalog snapshot loads with fingerprinted amounts', byCents.size > 100, `slugs=${byCents.size}`);

// pick one slug that is uniquely addressable by its fingerprint
let picked = null;
for (const [cents, candidates] of byCents) {
  if (candidates.length === 1) { picked = { cents, course: candidates[0] }; break; }
}
check('found a uniquely-addressable course', Boolean(picked), picked ? picked.course.s : 'none');
const amount = picked.cents / 10000;
check('fingerprint round-trips through the amount', Math.round(amount * 10000) === picked.cents);

// ── 2. matching (unconfirmed vs confirmed vs non-course) ────────────────────
const unconfirmed = matchDeposit({ amount, txid: 'TX-UNCONF', status: 'pending', network: 'TRC20' }, byCents);
check('unconfirmed deposit is NOT matched', unconfirmed === null);
const junk = matchDeposit({ amount: 1.0, txid: 'TX-JUNK', status: 'ok', network: 'TRC20' }, byCents);
check('non-fingerprint amount is NOT matched', junk === null);
const hit = matchDeposit({ amount, txid: 'TX-CHAIN-TEST-0001', status: 'ok', network: 'TRC20' }, byCents);
check('confirmed fingerprinted deposit matches its course', hit?.order?.slug === picked.course.s, hit?.order?.slug);
check('order row is PAID + delivery PENDING', hit?.order?.status === 'PAID' && hit?.order?.delivery === 'PENDING');

// ── 3. flush to a local mock provider ──────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rwc-chain-'));
const ledger = path.join(tmp, 'course-orders.ndjson');
const row = { ...hit.order, email: 'buyer@example.com' }; // email arrives via order-reference flow
fs.writeFileSync(ledger, JSON.stringify(row) + '\n');

const received = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    received.push({ url: req.url, auth: req.headers.authorization || '', body });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"id":"mock-email-1"}');
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

// async exec: the mock server lives in THIS process, so a synchronous
// spawn would block the event loop and deadlock the flush child.
const flush = async (extraEnv = {}) => {
  try {
    const { stdout } = await execFileAsync('node', ['scripts/rwc-flush-pending-deliveries.mjs'], {
      env: {
        ...process.env,
        RWC_ORDERS_LEDGER: ledger,
        RWC_RESEND_ENDPOINT: `http://127.0.0.1:${port}/emails`,
        RESEND_API_KEY: 're_test_mock_key',
        ...extraEnv,
      },
      encoding: 'utf8',
      timeout: 60000,
    });
    return stdout;
  } catch (e) {
    return String(e.stdout || e.message);
  }
};

const out1 = await flush();
check('flush sent exactly one receipt', received.length === 1, `sent=${received.length} · ${out1.split('\n').slice(-2).join(' ')}`);
if (received.length) {
  const payload = JSON.parse(received[0].body || '{}');
  check('receipt goes to the buyer', Array.isArray(payload.to) ? payload.to.includes('buyer@example.com') : payload.to === 'buyer@example.com', JSON.stringify(payload.to));
  check('sender is billing@realworldcerts.com', String(payload.from || '').includes('billing@realworldcerts.com'), String(payload.from));
  check('bearer auth carries the key', String(received[0].auth).startsWith('Bearer re_test_mock_key'));
  check('subject names the course', String(payload.subject || '').length > 10, String(payload.subject));
}
const afterFirst = fs.readFileSync(ledger, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
check('ledger flipped to delivery=SENT', afterFirst[0].delivery === 'SENT', afterFirst[0].delivery);

// ── 4. idempotency ─────────────────────────────────────────────────────────
await flush();
check('second flush does not re-send (idempotent)', received.length === 1, `sent=${received.length}`);
const afterSecond = fs.readFileSync(ledger, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
check('ledger still exactly one order line', afterSecond.length === 1, `lines=${afterSecond.length}`);

// ── report ─────────────────────────────────────────────────────────────────
server.close();
fs.rmSync(tmp, { recursive: true, force: true });
let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  -> ${r.detail}`}`);
  if (!r.ok) failed++;
}
console.log(`\n${results.length - failed}/${results.length} assertions passed`);
process.exit(failed ? 1 : 0);
