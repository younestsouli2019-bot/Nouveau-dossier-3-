#!/usr/bin/env node
/**
 * test-po-tracking-shape.mjs — locks the carrier-tracking contract documented
 * in docs/PO-DELIVERY-TRACKING.md against scripts/lib/po-delivery.mjs.
 *
 * Proves:
 *  1. The versioned template parses and every carrier in it normalizes to an
 *     AUTHORIZED_CARRIERS member.
 *  2. Placeholder tracking numbers are rejected (PO_GUARD_NO_TRACKING).
 *  3. An unauthorized carrier (POSTE MAROC) is rejected, not silently accepted.
 *  4. A valid shape yields status by evidence: label_created -> in_transit ->
 *     delivered (the last only with a receipt scan in a flat receivedDir).
 *  5. A non-object tracking file fails closed.
 *
 * Run: node scripts/test-po-tracking-shape.mjs   (exit 0 = contract holds)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const m = await import('../scripts/lib/po-delivery.mjs');

const results = [];
const check = (name, cond, detail = '') => results.push({ name, ok: Boolean(cond), detail });

// ── 1. template contract ────────────────────────────────────────────────────
const tplPath = 'docs/templates/carrier-tracking.template.json';
let tpl = {};
try { tpl = JSON.parse(fs.readFileSync(tplPath, 'utf8')); } catch (e) {
  check('template parses as JSON', false, e.message);
}
const entries = Object.entries(tpl).filter(([k]) => k.startsWith('SWARM-PO'));
check('template keys are PO refs', entries.length === 3, `keys=${entries.length}`);
check('every template carrier is authorized',
  entries.every(([, v]) => Boolean(m.normalizeCarrier(v.carrier))),
  entries.map(([k, v]) => `${k}:${m.normalizeCarrier(v.carrier)}`).join(' '));

// ── 2. placeholders rejected ────────────────────────────────────────────────
const po = m.OWNER_POS[0];
for (const bad of ['', 'TEST', 'tbd', 'unknown', 'xxxxxx']) {
  let code = null;
  try { m.assertRealTracking({ carrier: po.carrier, trackingNumber: bad, poRef: po.poRef }); }
  catch (e) { code = e.code; }
  check(`placeholder tracking "${bad || '(empty)'}" rejected`, code === 'PO_GUARD_NO_TRACKING', String(code));
}
check('real-format tracking accepted',
  m.assertRealTracking({ carrier: po.carrier, trackingNumber: 'EE123456789MA', poRef: po.poRef }).trackingNumber === 'EE123456789MA');

// ── 3. unauthorized carrier ─────────────────────────────────────────────────
let carrierCode = null;
try { m.assertCarrier('POSTE MAROC', po.poRef); } catch (e) { carrierCode = e.code; }
check('POSTE MAROC rejected (not in AUTHORIZED_CARRIERS)', carrierCode !== null && m.normalizeCarrier('POSTE MAROC') === null, String(carrierCode));
check('prefix aliases normalize', m.normalizeCarrier('Amana Express') === 'AMANA' && m.normalizeCarrier('chrono diali') === 'CHRONO_DIALI');

// ── 4. status by evidence ───────────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'po-shape-'));
const base = { carrier: po.carrier, trackingNumber: 'EE123456789MA', events: [] };
const s1 = m.assessPo({ po, trackingEntry: base, receivedDir: tmp });
check('tracking + no events -> label_created', s1.status === 'label_created', String(s1.status));
const s2 = m.assessPo({ po, trackingEntry: { ...base, events: [{ at: '2026-10-07T10:00:00Z', status: 'en_transit' }] }, receivedDir: tmp });
check('tracking + events -> in_transit', s2.status === 'in_transit', String(s2.status));
fs.writeFileSync(path.join(tmp, `${po.poRef}-${m.normalizeCarrier(po.carrier)}-signed.pdf`), 'signed-delivery-note-scan');
const s3 = m.assessPo({ po, trackingEntry: base, receivedDir: tmp });
check('tracking + signed scan -> delivered with POD ref', s3.status === 'delivered' && /^POD:AMANA:[a-f0-9]{64}$/.test(String(s3.pod?.podRef)), String(s3.pod?.podRef));
check('POD hash matches the scan bytes', s3.pod?.sha256 === m.sha256Hex(fs.readFileSync(path.join(tmp, `${po.poRef}-AMANA-signed.pdf`))));

// ── 5. loader fail-closed ───────────────────────────────────────────────────
const arrPath = path.join(tmp, 'array.json');
fs.writeFileSync(arrPath, '[]');
let loadCode = null;
try { m.loadCarrierTracking(arrPath); } catch (e) { loadCode = e.code; }
check('array tracking file fails closed', loadCode === 'PO_GUARD_BAD_TRACKING_FILE', String(loadCode));

// ── report ──────────────────────────────────────────────────────────────────
let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  -> ${r.detail}`}`);
  if (!r.ok) failed++;
}
console.log(`\n${results.length - failed}/${results.length} assertions passed`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
