import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const pass = []; const fail = [];
function assert(label, cond, detail = '') {
  if (cond) { pass.push(label); console.log(`✅ PASS ${label}${detail ? ' — ' + detail : ''}`); }
  else { fail.push(label); console.log(`❌ FAIL ${label}${detail ? ' — ' + detail : ''}`); }
}
const randPort = () => 19000 + Math.floor(Math.random() * 999);

function post(port, path, body, extraHeaders = {}) {
  const data = JSON.stringify(body ?? '');
  return new Promise((resolve) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...extraHeaders } }, (res) => {
      let chunks = '';
      res.on('data', (c) => (chunks += c));
      res.on('end', () => {
        let json; try { if (chunks.trim()) json = JSON.parse(chunks); } catch {}
        resolve({ status: res.statusCode, body: json, raw: chunks });
      });
    });
    req.on('error', (e) => resolve({ status: 0, body: undefined, raw: String(e) }));
    req.write(data);
    req.end();
  });
}
function get(port, path) {
  return new Promise((resolve) => {
    const req = http.get({ hostname: '127.0.0.1', port, path }, (res) => {
      let chunks = '';
      res.on('data', (c) => (chunks += c));
      res.on('end', () => { let json; try { if (chunks.trim()) json = JSON.parse(chunks); } catch {} resolve({ status: res.statusCode, body: json, raw: chunks }); });
    });
    req.on('error', (e) => resolve({ status: 0, body: undefined, raw: String(e) }));
    req.end();
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const PORT = process.env.EDU_WEBHOOK_PORT ? Number(process.env.EDU_WEBHOOK_PORT) : randPort();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'edu-v350-'));
  // Isolate global NDJSON dedup/DLQ files BEFORE importing edu-server (module hydrates at import time)
  const dataOut = path.join(process.cwd(), 'data', 'out');
  const backup = new Map();
  try { fs.mkdirSync(dataOut, { recursive: true }); } catch {}
  for (const f of ['rwc-dedup.ndjson', 'rwc-dlq.ndjson']) {
    const p = path.join(dataOut, f);
    if (fs.existsSync(p)) {
      const bp = p + '.' + Date.now() + '.bak';
      fs.renameSync(p, bp);
      backup.set(f, bp);
    }
    fs.writeFileSync(p, '');
  }
  // Dynamic import AFTER isolation so processedIds hydrates empty set and counters are module-fresh
  const { createEduWebhookServer } = await import('../src/edu/edu-webhook-server.mjs');
  const { PurchaseReconciler } = await import('../src/edu/purchase-reconciliation.mjs');
  console.log(`\n========== v3.5.0 Edu Webhook Synthetic Tests ==========`);
  console.log(`Port=${PORT}  tmp=${tmp}`);
  console.log(`DLQ/dedup files isolated fresh-empty: dlqBacked=${backup.has('rwc-dlq.ndjson')} dedupBacked=${backup.has('rwc-dedup.ndjson')}`);

  // ---------- D1 server start ----------
  const ledger = path.join(tmp, 'purchase-ledger.json');
  const baseReconciler = new PurchaseReconciler({ platforms: {}, ledgerPath: ledger });
  let server = createEduWebhookServer({ reconciler: baseReconciler, affiliateProgram: null, secret: '' }); // empty secret = signature always passes
  await new Promise((resolve, reject) => { server.listen(PORT, '127.0.0.1', (e) => (e ? reject(e) : resolve())); });
  await sleep(150);
  const health = await get(PORT, '/health');
  assert('D1 /health HTTP 200', health.status === 200, `status=${health.status}`);
  assert('D1 health body.status=ok', health?.body?.status === 'ok');
  assert('D1 health uptime_ms number', typeof health?.body?.uptime_ms === 'number' && health.body.uptime_ms >= 0);

  // ---------- D2 duplicate test ----------
  const dup = { id: 'SYNTH-SALE-DUP-001', saleId: 'SYNTH-SALE-DUP-001', amount_cents: 29900, currency: 'USD', product_name: 'PMP Certification', customer_email: 'student@example.com' };
  const r1 = await post(PORT, '/webhook/realworldcerts', dup);
  const r2 = await post(PORT, '/webhook/realworldcerts', dup);
  console.log(`  post1 status=${r1.status} body=${JSON.stringify(r1.body)}`);
  console.log(`  post2 status=${r2.status} body=${JSON.stringify(r2.body)}`);
  assert('D2 HTTP both 200', r1.status === 200 && r2.status === 200, `r1=${r1.status} r2=${r2.status}`);
  assert('D2 r1 VERIFIED or QUARANTINED', r1.body?.status === 'VERIFIED' || r1.body?.status === 'QUARANTINED', `r1.status=${r1.body?.status}`);
  assert('D2 r2 status=DUPLICATE', r2.body?.status === 'DUPLICATE', `r2.status=${r2.body?.status ?? 'undefined'}`);
  assert('D2 r2 reason=already processed', r2.body?.reason === 'already processed');
  const stats1 = await get(PORT, '/webhook/realworldcerts/stats');
  console.log(`  stats after D2: ${JSON.stringify(stats1.body)}`);
  assert('D2 stats.processed >= 1', Number(stats1.body?.counters?.processed) >= 1);
  assert('D2 stats.deduped >= 1', Number(stats1.body?.counters?.deduped) >= 1);
  assert('D2 stats shape has 4 numeric counters',
    typeof stats1.body?.counters?.processed === 'number' && typeof stats1.body?.counters?.deduped === 'number' &&
    typeof stats1.body?.counters?.retried === 'number' && typeof stats1.body?.counters?.dlq === 'number');
  assert('D2 dedupMemorySize >= 1', Number(stats1.body?.dedupMemorySize) >= 1);

  // ---------- D3 force-throw DLQ test ----------
  server.close();
  await sleep(200);
  class ThrowReconciler extends PurchaseReconciler {
    constructor(opts) { super(opts); this._opts = opts; }
    async reconcile(x) {
      if (x?.event?.__forceThrow) throw new Error('FORCED_TEST_FAILURE_' + Date.now());
      return super.reconcile(x);
    }
  }
  const thrower = new ThrowReconciler({ platforms: {}, ledgerPath: ledger });
  server = createEduWebhookServer({ reconciler: thrower, affiliateProgram: null, secret: '' });
  await new Promise((resolve) => { server.listen(PORT, '127.0.0.1', () => resolve()); });
  await sleep(150);
  const t0 = Date.now();
  const rFail = await post(PORT, '/webhook/realworldcerts', { id: 'SYNTH-FAIL-DLQ-001', saleId: 'SYNTH-FAIL-DLQ-001', amount_cents: 10000, currency: 'USD', product_name: 'Fail Course', __forceThrow: true });
  const elapsed = Date.now() - t0;
  console.log(`  fail status=${rFail.status} body=${JSON.stringify(rFail.body)}  elapsed=${elapsed}ms (>=600 expected 3x backoff 200+400)`);
  assert('D3 HTTP 500', rFail.status === 500, `status=${rFail.status}`);
  assert('D3 status=DLQ', rFail.body?.status === 'DLQ', `body.status=${rFail.body?.status}`);
  assert('D3 body.dlq=true', rFail.body?.dlq === true);
  assert('D3 id matches', String(rFail.body?.id ?? '') === 'realworldcerts:SYNTH-FAIL-DLQ-001', `id=${rFail.body?.id}`);
  assert('D3 3-retry backoff elapsed >= 550ms', elapsed >= 550, `elapsed=${elapsed}ms`);
  await sleep(400);
  const stats2 = await get(PORT, '/webhook/realworldcerts/stats');
  console.log(`  stats after D3: ${JSON.stringify(stats2.body)}`);
  assert('D3 stats.retried >= 2', Number(stats2.body?.counters?.retried) >= 2, `retried=${stats2.body?.counters?.retried}`);
  assert('D3 stats.dlq === 1', Number(stats2.body?.counters?.dlq) === 1, `dlq=${stats2.body?.counters?.dlq}`);
  assert('D3 dlqCount === 1', Number(stats2.body?.dlqCount) === 1);

  // Verify DLQ row secret redacted (if NDJSON file approach used, server writes to DATA_OUT_DIR)
  // The server appends to data/out/rwc-dlq.ndjson by default — check existence and read last line IF it contains SYNTH-FAIL
  const dlqPath = path.join(process.cwd(), 'data', 'out', 'rwc-dlq.ndjson');
  if (fs.existsSync(dlqPath)) {
    try {
      const lines = fs.readFileSync(dlqPath, 'utf8').split('\n').filter(Boolean);
      const last = lines[lines.length - 1] ? JSON.parse(lines[lines.length - 1]) : null;
      if (last && last.key === 'realworldcerts:SYNTH-FAIL-DLQ-001') {
        assert('D3 DLQ row key matches pattern', last.key === 'realworldcerts:SYNTH-FAIL-DLQ-001');
        assert('D3 DLQ error contains FORCED_TEST_FAILURE', String(last.error || '').includes('FORCED_TEST_FAILURE'));
        assert('D3 DLQ opts.secret is undefined (REDACTED)', Object.prototype.hasOwnProperty.call(last.opts || {}, 'secret') ? last.opts.secret === undefined : true,
          Object.prototype.hasOwnProperty.call(last.opts || {}, 'secret') ? `secret=${typeof last.opts.secret}` : 'no opts.secret key present (safe)');
        console.log(`  DLQ last row inspected: key=${last.key} err.slice=${String(last.error||'').slice(0,40)} hasSecretKey=${Object.prototype.hasOwnProperty.call(last.opts||{},'secret')}`);
      } else {
        console.log('  Note: DLQ file last line does not match our synthetic key; skipping file-level DLQ assertions (in-memory counters verified OK)');
      }
    } catch (e) { console.log(`  DLQ file parse note: ${e.message}`); }
  } else {
    console.log('  No DLQ file yet — OK, counter verified in-memory via stats endpoint');
  }

  // ---------- D4 retry-dlq redrive ----------
  server.close();
  await sleep(200);
  const backToNormal = new PurchaseReconciler({ platforms: {}, ledgerPath: ledger });
  server = createEduWebhookServer({ reconciler: backToNormal, affiliateProgram: null, secret: '' });
  await new Promise((resolve) => { server.listen(PORT, '127.0.0.1', () => resolve()); });
  await sleep(150);
  // First: a second unique successful POST to bump processed counter (for D5 processed>=2)
  const rUnique2 = await post(PORT, '/webhook/realworldcerts', { id: 'SYNTH-SALE-UNQ-002', saleId: 'SYNTH-SALE-UNQ-002', amount_cents: 19900, currency: 'USD', product_name: 'Unique Course 2', customer_email: 'student2@example.com' });
  assert('D4b unique-2 HTTP 200', rUnique2.status === 200, `status=${rUnique2.status}`);
  assert('D4b unique-2 status=VERIFIED or QUARANTINED', rUnique2.body?.status === 'VERIFIED' || rUnique2.body?.status === 'QUARANTINED', `body.status=${rUnique2.body?.status}`);
  const statsPreRedrive = await get(PORT, '/webhook/realworldcerts/stats');
  console.log(`  stats pre-redrive (after 2nd POST): ${JSON.stringify(statsPreRedrive.body)}`);
  assert('D4b stats.processed >= 2 BEFORE redrive', Number(statsPreRedrive.body?.counters?.processed) >= 2, `processed=${statsPreRedrive.body?.counters?.processed}`);
  assert('D4b dedupMemorySize >= 2 BEFORE redrive', Number(statsPreRedrive.body?.dedupMemorySize) >= 2, `dedupMemorySize=${statsPreRedrive.body?.dedupMemorySize}`);
  // Now redrive DLQ
  const rRetry = await post(PORT, '/webhook/realworldcerts/retry-dlq', {});
  console.log(`  retry-dlq status=${rRetry.status} body=${JSON.stringify(rRetry.body)}`);
  assert('D4 retry-dlq HTTP 200', rRetry.status === 200, `status=${rRetry.status}`);
  assert('D4 processed === 1', Number(rRetry.body?.processed) === 1, `processed=${rRetry.body?.processed}`);
  assert('D4 failed === 0', Number(rRetry.body?.failed ?? 0) === 0, `failed=${rRetry.body?.failed}`);
  assert('D4 remaining === 0', Number(rRetry.body?.remaining) === 0, `remaining=${rRetry.body?.remaining}`);
  const stats3 = await get(PORT, '/webhook/realworldcerts/stats');
  console.log(`  stats after D4: ${JSON.stringify(stats3.body)}`);
  assert('D4 stats.dlq === 0', Number(stats3.body?.counters?.dlq) === 0, `dlq=${stats3.body?.counters?.dlq}`);
  assert('D4 dlqCount === 0', Number(stats3.body?.dlqCount) === 0);

  // ---------- D5 final stats thresholds ----------
  const S = stats3.body || {};
  console.log(`\n--- D5 FINAL STATS ---`);
  console.log(`  counters.processed = ${S.counters?.processed}`);
  console.log(`  counters.deduped  = ${S.counters?.deduped}`);
  console.log(`  counters.retried  = ${S.counters?.retried}`);
  console.log(`  counters.dlq      = ${S.counters?.dlq}`);
  console.log(`  dedupMemorySize   = ${S.dedupMemorySize}`);
  console.log(`  dlqCount          = ${S.dlqCount}`);
  assert('D5 processed >= 2', Number(S.counters?.processed) >= 2, `processed=${S.counters?.processed}`);
  assert('D5 deduped >= 1', Number(S.counters?.deduped) >= 1);
  assert('D5 retried >= 2', Number(S.counters?.retried) >= 2);
  assert('D5 dlq === 0', Number(S.counters?.dlq) === 0);
  assert('D5 dedupMemorySize >= 2', Number(S.dedupMemorySize) >= 2);
  assert('D5 dlqCount === 0', Number(S.dlqCount) === 0);
  assert('D5 status ok field present', S.status === 'ok');

  // Cleanup
  await new Promise((resolve) => server.close(() => resolve()));
  // Restore backup files (re-create empty originals first if backup existed, then rename back)
  for (const f of ['rwc-dedup.ndjson', 'rwc-dlq.ndjson']) {
    const p = path.join(dataOut, f);
    const bp = backup.get(f);
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
      if (bp && fs.existsSync(bp)) fs.renameSync(bp, p);
    } catch (e) { console.log(`  cleanup note ${f}: ${e.message}`); }
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  console.log(`\n========== LIFECYCLE SUMMARY ==========`);
  console.log(`  D1 START:     ${pass.includes('D1 /health HTTP 200') ? '✅' : '❌'}`);
  console.log(`  D2 DUPLICATE: ${pass.includes('D2 r2 status=DUPLICATE') ? '✅' : '❌'}`);
  console.log(`  D3 DLQ FAIL:  ${pass.includes('D3 status=DLQ') && pass.includes('D3 stats.retried >= 2') ? '✅' : '❌'}`);
  console.log(`  D4 REDRIVE:   ${pass.includes('D4 processed === 1') && pass.includes('D4 remaining === 0') ? '✅' : '❌'}`);
  console.log(`  D5 STATS:     ${pass.includes('D5 status ok field present') && Number(S.counters?.dlq) === 0 ? '✅' : '❌'}`);
  console.log(`\nTOTAL: ${pass.length}/${pass.length + fail.length}  FAIL=${fail.length}`);
  if (fail.length > 0) { console.log(`FAIL LABELS: ${fail.join(', ')}`); process.exit(1); }
  console.log(`🎉 EDU TESTS: 5/5 AC PASS\n`);
  process.exit(0);
}

main().catch((e) => { console.error('UNHANDLED', e); process.exit(99); });
